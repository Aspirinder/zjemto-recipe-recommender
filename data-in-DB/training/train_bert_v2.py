"""Fine-tune MiniLM for ZjemTo ingredient classification.

Run from data/ with: python training/train_bert_v2.py
A new run is saved separately in data/training_run/.
The existing model and reference train/validation/test CSVs are not overwritten.
"""

import argparse
import csv
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRAINING_DIR = ROOT / 'training'
MODEL = 'sentence-transformers/all-MiniLM-L6-v2'
SPLIT_NAMES = ('train', 'validation', 'test')
THRESHOLDS = (0.7, 0.8, 0.9, 0.95, 0.99)

# The shared group parser lives in the standalone V5 normalizer.
sys.path.insert(0, str(ROOT))

def parse_groups(row, base_for):
    """Convert old group IDs into base group IDs, retaining AND/OR structure."""
    raw = (row.get('group_requirements') or '').strip()
    if raw and raw.lower() not in ('null', 'none'):
        reqs = json.loads(raw)
    elif (row.get('group_id') or '').strip():
        reqs = [[int(row['group_id'])]]
    else:
        return None
    if not isinstance(reqs, list) or not reqs:
        return None
    result = []
    for clause in reqs:
        if not isinstance(clause, list) or not clause:
            return None
        mapped = []
        for x in clause:
            try:
                old = int(x)
            except (TypeError, ValueError):
                return None
            if old not in base_for:
                return None
            mapped.append(base_for[old])
        result.append(sorted(set(mapped)))
    return result

def read_rows(path):
    with path.open(encoding='utf-8-sig', newline='') as file:
        yield from csv.DictReader(file)


def write_json(path, data, **kwargs):
    path.write_text(json.dumps(data, indent=2, **kwargs), encoding='utf-8')


def write_csv(path, header, records):
    with path.open('w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(header)
        writer.writerows(records)


def ingredient_key(text):
    """Normalize text for deduplication, not for the model input."""
    return ' '.join(re.sub(r'[^\w]+', ' ', text.casefold()).split())


def load_groups():
    members = {
        int(row['group_id']): int(row['base_group_id'])
        for row in read_rows(ROOT / 'ingredient_base_group_members.csv')
    }
    names = {
        int(row['base_group_id']): row['canonical_name']
        for row in read_rows(ROOT / 'ingredient_base_groups.csv')
    }
    return members, names


def collect_examples(members, names):
    """Keep only unambiguous, single-class ingredient examples."""

    groups_by_key = defaultdict(set)
    original_text = {}
    blocked_keys = set()
    counts = Counter()

    for row in read_rows(ROOT / 'ingredient_mapping.csv'):
        counts['rows'] += 1
        text = (row.get('ingredient') or '').strip()
        key = ingredient_key(text)
        if not key:
            continue

        try:
            requirements = parse_groups(row, members)
        except (ValueError, TypeError, KeyError):
            counts['invalid'] += 1
            continue

        if not requirements:
            counts['unmapped'] += 1
            continue

        if (len(requirements) != 1 or len(requirements[0]) != 1
                or re.search(r'\b(and|or)\b|/', text, re.I)):
            counts['compound'] += 1
            blocked_keys.add(key)
            continue

        group_id = requirements[0][0]
        if group_id not in names:
            counts['invalid'] += 1
            continue

        groups_by_key[key].add(group_id)
        original_text.setdefault(key, text)

    examples = defaultdict(list)
    for key, group_ids in groups_by_key.items():
        if key in blocked_keys or len(group_ids) != 1:
            counts['ambiguous'] += 1
            continue

        group_id = next(iter(group_ids))
        examples[group_id].append(original_text[key])

    return examples, counts


def split_dataset(examples, names, seed, min_examples):
    """Use the original V2 per-class split and shuffle order."""
    rng = random.Random(seed)
    splits = {name: [] for name in SPLIT_NAMES}
    excluded = []

    for group_id, texts in sorted(examples.items()):
        if len(texts) < min_examples:
            excluded.append({
                'base_group_id': group_id,
                'name': names[group_id],
                'examples': len(texts),
            })
            continue

        rng.shuffle(texts)
        size = max(1, round(len(texts) * 0.1))
        partitions = (
            ('test', texts[:size]),
            ('validation', texts[size:2 * size]),
            ('train', texts[2 * size:]),
        )
        for split, part in partitions:
            splits[split].extend((text, group_id) for text in part)

    for data in splits.values():
        rng.shuffle(data)

    return splits, excluded


def prepare_dataset(args):
    members, names = load_groups()
    examples, counts = collect_examples(members, names)
    splits, excluded = split_dataset(
        examples, names, args.seed, args.min_examples
    )
    group_ids = sorted({group_id for _, group_id in splits['train']})
    report = {
        'mapping_counts': dict(counts),
        'classes': len(group_ids),
        'sizes': {name: len(data) for name, data in splits.items()},
        'excluded_classes': excluded,
        'classes_without_examples': [g for g in names if g not in examples],
    }
    return splits, group_ids, names, report


def verify_reference_splits(splits):
    """Verify that the new run uses exactly the saved reference examples."""
    for name, data in splits.items():
        path = TRAINING_DIR / f'{name}.csv'
        if not path.is_file():
            raise ValueError(f'Missing reference split: {path}')
        expected = [
            (row['ingredient'], int(row['base_group_id']))
            for row in read_rows(path)
        ]
        if expected != data:
            raise ValueError(f'{name} differs from the saved split; check inputs and seed')
    print('All three splits match the saved reference exactly.', flush=True)


def save_dataset(output, splits, report):
    for name, data in splits.items():
        write_csv(output / f'{name}.csv', ['ingredient', 'base_group_id'], data)
    write_json(output / 'dataset_stats.json', report, ensure_ascii=False)
    print(json.dumps({k: v for k, v in report.items() if not isinstance(v, list)},
                     indent=2), flush=True)


def create_loaders(splits, tokenizer, group_ids, args):
    import torch
    from torch.utils.data import DataLoader

    label_index = {group_id: index for index, group_id in enumerate(group_ids)}

    def collate(batch):
        texts, groups = zip(*batch)
        inputs = tokenizer(
            list(texts), padding=True, truncation=True,
            max_length=args.max_length, return_tensors='pt',
        )
        labels = torch.tensor([label_index[group] for group in groups])
        return inputs, labels

    return {
        name: DataLoader(data, batch_size=args.batch_size,
                         shuffle=name == 'train', collate_fn=collate)
        for name, data in splits.items()
    }


def calculate_class_weights(train_data, group_ids, power, device):
    import torch

    frequencies = Counter(group_id for _, group_id in train_data)
    weights = torch.tensor([
        (len(train_data) / (len(group_ids) * frequencies[group_id])) ** power
        for group_id in group_ids
    ], dtype=torch.float32, device=device)
    return weights / weights.mean()


def move_inputs(inputs, device):
    return {name: tensor.to(device) for name, tensor in inputs.items()}


def train_one_epoch(model, loader, criterion, optimizer, scheduler, device, epoch):
    import torch

    model.train()
    total_loss = 0.0
    examples_seen = 0

    for step, (inputs, labels) in enumerate(loader, start=1):
        labels = labels.to(device)
        optimizer.zero_grad(set_to_none=True)

        logits = model(**move_inputs(inputs, device)).logits
        loss = criterion(logits, labels)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        optimizer.step()
        scheduler.step()

        total_loss += float(loss.detach()) * len(labels)
        examples_seen += len(labels)
        if step % 100 == 0:
            print(f'Epoch {epoch} | {step}/{len(loader)} | '
                  f'loss {total_loss / examples_seen:.4f}', flush=True)

    return total_loss / examples_seen


def threshold_metrics(labels, predictions, scores, margins):
    results = []
    for threshold in THRESHOLDS:
        accepted = (scores >= threshold) & (margins >= 0.1)
        results.append({
            'score': threshold,
            'margin': 0.1,
            'accepted': int(accepted.sum()),
            'coverage': float(accepted.mean()),
            'accuracy': float((labels[accepted] == predictions[accepted]).mean())
            if accepted.any() else None,
        })
    return results


def evaluate(model, loader, device, num_classes):
    """Evaluate without gradients; preserve the original unweighted eval loss."""
    import numpy as np
    import torch
    from sklearn.metrics import accuracy_score, f1_score

    model.eval()
    labels_list, predictions_list = [], []
    confidence_list, margin_list, top3_list, losses = [], [], [], []

    with torch.inference_mode():
        for inputs, labels in loader:
            labels = labels.to(device)
            result = model(**move_inputs(inputs, device), labels=labels)
            probabilities = result.logits.softmax(-1)
            scores, indices = probabilities.topk(min(3, num_classes), dim=-1)

            labels_list.extend(labels.cpu().tolist())
            predictions_list.extend(indices[:, 0].cpu().tolist())
            confidence_list.extend(scores[:, 0].cpu().tolist())
            margin_list.extend((scores[:, 0] - scores[:, 1]).cpu().tolist())
            top3_list.extend((indices == labels[:, None]).any(1).cpu().tolist())
            losses.append(float(result.loss) * len(labels))

    labels = np.array(labels_list)
    predictions = np.array(predictions_list)
    confidence = np.array(confidence_list)
    margins = np.array(margin_list)
    metrics = {
        'loss': sum(losses) / len(labels),
        'accuracy': float(accuracy_score(labels, predictions)),
        'macro_f1': float(f1_score(labels, predictions, average='macro', zero_division=0)),
        'weighted_f1': float(f1_score(labels, predictions, average='weighted', zero_division=0)),
        'top3_accuracy': float(np.mean(top3_list)),
        'thresholds': threshold_metrics(labels, predictions, confidence, margins),
    }
    return metrics, labels, predictions, confidence, margins


def fit_model(args, output, model, tokenizer, loaders, criterion, optimizer, scheduler,
              device, num_classes):
    """Train, select the best validation Macro F1 and apply early stopping."""
    history = []
    best_f1 = -1
    best_epoch = 0
    stop_reference = -1
    stale_epochs = 0
    model_dir = output / 'model'

    for epoch in range(1, args.epochs + 1):
        train_loss = train_one_epoch(
            model, loaders['train'], criterion, optimizer, scheduler, device, epoch
        )
        metrics, *_ = evaluate(model, loaders['validation'], device, num_classes)
        history.append({
            'epoch': epoch,
            'train_loss': train_loss,
            'train_loss_type': 'weighted_batch_mean',
            'validation': metrics,
        })
        print(json.dumps(history[-1]), flush=True)
        write_json(output / 'history.json', history)

        macro_f1 = metrics['macro_f1']
        if macro_f1 > best_f1:
            best_f1 = macro_f1
            best_epoch = epoch
            model.save_pretrained(model_dir)
            tokenizer.save_pretrained(model_dir)

        if macro_f1 > stop_reference + args.min_delta:
            stop_reference = macro_f1
            stale_epochs = 0
        else:
            stale_epochs += 1

        print(f'Best epoch: {best_epoch} | Macro F1: {best_f1:.4f} | '
              f'Early stopping: {stale_epochs}/{args.patience}', flush=True)
        if stale_epochs >= args.patience:
            print('Early stopping triggered', flush=True)
            break

    return model_dir, best_epoch, len(history)


def compare_with_v1(output, metrics):
    previous = TRAINING_DIR / 'test_metrics_v1.json'
    if not previous.is_file():
        print('V1 metrics not found; skipping comparison.', flush=True)
        return

    old = json.loads(previous.read_text(encoding='utf-8'))
    keys = ('accuracy', 'macro_f1', 'weighted_f1', 'top3_accuracy')
    comparison = {
        key: {'v1': old[key], 'v2': metrics[key], 'delta': metrics[key] - old[key]}
        for key in keys if key in old
    }
    write_json(output / 'comparison_v1_v2.json', comparison)
    print(json.dumps(comparison, indent=2), flush=True)


def save_test_results(output, result, splits, group_ids, names, best_epoch, epochs):
    from sklearn.metrics import classification_report

    metrics, labels, predictions, confidence, margins = result
    majority = Counter(group for _, group in splits['train']).most_common(1)[0][0]
    metrics['best_epoch'] = best_epoch
    metrics['epochs_completed'] = epochs
    metrics['majority_baseline_accuracy'] = (
        sum(group == majority for _, group in splits['test']) / len(labels)
    )
    write_json(output / 'test_metrics.json', metrics)

    report = classification_report(
        labels, predictions, labels=list(range(len(group_ids))),
        target_names=[f'{group}: {names[group]}' for group in group_ids],
        zero_division=0, output_dict=True,
    )
    write_json(output / 'class_report.json', report)

    records = (
        (text, group, group_ids[int(pred)], float(score), float(margin))
        for (text, group), pred, score, margin
        in zip(splits['test'], predictions, confidence, margins)
    )
    write_csv(output / 'test_predictions.csv',
              ['ingredient', 'true_group_id', 'predicted_group_id', 'confidence', 'margin'],
              records)
    print(json.dumps(metrics, indent=2), flush=True)
    compare_with_v1(output, metrics)


def train(args, output, splits, group_ids, names):
    import numpy as np
    import torch
    from transformers import (
        AutoTokenizer, AutoModelForSequenceClassification,
        get_linear_schedule_with_warmup,
    )

    if len(group_ids) < 2:
        raise ValueError('Need at least two eligible classes')

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    device = torch.device('cuda' if torch.cuda.is_available() and not args.cpu else 'cpu')
    print('Device:', device, flush=True)

    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL, num_labels=len(group_ids),
        id2label={i: str(g) for i, g in enumerate(group_ids)},
        label2id={str(g): i for i, g in enumerate(group_ids)},
    ).to(device)
    loaders = create_loaders(splits, tokenizer, group_ids, args)
    weights = calculate_class_weights(splits['train'], group_ids, args.weight_power, device)
    criterion = torch.nn.CrossEntropyLoss(weight=weights)

    write_json(output / 'training_config.json', {
        **vars(args), 'model': MODEL, 'selection_metric': 'macro_f1',
        'class_weights': {str(g): float(w) for g, w in zip(group_ids, weights.cpu().tolist())},
    })

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = len(loaders['train']) * args.epochs
    scheduler = get_linear_schedule_with_warmup(optimizer, int(steps * 0.1), steps)

    model_dir, best_epoch, epochs = fit_model(
        args, output, model, tokenizer, loaders, criterion, optimizer, scheduler,
        device, len(group_ids),
    )
    # The original optimizer still holds references to the training model.
    # Release them before loading the saved checkpoint, to reduce GPU memory use.
    del scheduler, optimizer, model
    model = AutoModelForSequenceClassification.from_pretrained(model_dir).to(device)
    result = evaluate(model, loaders['test'], device, len(group_ids))
    save_test_results(output, result, splits, group_ids, names, best_epoch, epochs)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true')
    parser.add_argument('--epochs', type=int, default=8)
    parser.add_argument('--batch-size', type=int, default=32)
    parser.add_argument('--max-length', type=int, default=64)
    parser.add_argument('--min-examples', type=int, default=5)
    parser.add_argument('--lr', type=float, default=2e-5)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--cpu', action='store_true')
    parser.add_argument('--output', default='training_run')
    parser.add_argument('--weight-power', type=float, default=0.5)
    parser.add_argument('--patience', type=int, default=2)
    parser.add_argument('--min-delta', type=float, default=0.001)
    args = parser.parse_args()

    if min(args.epochs, args.batch_size, args.max_length) < 1 or args.min_examples < 5:
        parser.error('Positive sizes required, min-examples >= 5')
    if args.patience < 1 or not 0 <= args.weight_power <= 1 or args.min_delta < 0:
        parser.error('Invalid early stopping or weight settings')
    return args


def main():
    args = parse_args()
    output = (ROOT / args.output).resolve()
    # Refuse to overwrite any nonempty folder, including archived runs.
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise SystemExit(f'Output already exists and is not empty: {output}. Choose --output.')

    splits, group_ids, names, report = prepare_dataset(args)
    verify_reference_splits(splits)
    output.mkdir(parents=True, exist_ok=True)
    save_dataset(output, splits, report)

    if not args.prepare_only:
        train(args, output, splits, group_ids, names)


if __name__ == '__main__':
    main()
