"""Classify ingredient atoms with the locally trained MiniLM model.

The script produces predictions for the V5 normalizer and review statistics.
It does not train the model or modify the recipe database.
"""

import argparse
import csv
import json
import random
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent
THRESHOLDS = (0.70, 0.80, 0.90, 0.95, 0.99)
COMPLEX_PATTERN = re.compile(r'\b(?:and|or|and/or)\b|[()/;\[\]&+]', re.I)

PREDICTION_FIELDS = [
    'ingredient', 'occurrences', 'status', 'confidence', 'margin', 'truncated',
]
for rank in range(1, 4):
    PREDICTION_FIELDS.extend([
        f'group_id_{rank}', f'group_name_{rank}', f'score_{rank}',
    ])
PREDICTION_FIELDS.extend(['approved_group_id', 'review_note'])


def read_rows(path):
    """Read a CSV file as dictionaries."""
    with path.open(encoding='utf-8-sig', newline='') as file:
        yield from csv.DictReader(file)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=0,
                        help='0 = all rows; otherwise first N by frequency')
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--score', type=float, default=0.90)
    parser.add_argument('--margin', type=float, default=0.10)
    parser.add_argument('--max-length', type=int, default=64)
    parser.add_argument('--cpu', action='store_true')
    parser.add_argument('--model', default='model')
    parser.add_argument('--input', default='output/atoms.csv')
    parser.add_argument('--output', default='output')
    parser.add_argument('--sample-size', type=int, default=200,
                        help='Random sample per review category')
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    if args.limit < 0 or args.batch_size < 1 or args.max_length < 4:
        parser.error('Invalid limit, batch size or maximum token length')
    if args.sample_size < 0 or not (0 <= args.score <= 1 and 0 <= args.margin <= 1):
        parser.error('Invalid sample size or confidence thresholds')

    args.model = ROOT / args.model
    args.input = ROOT / args.input
    args.output = ROOT / args.output

    for path in (args.model / 'config.json', args.input,
                 ROOT / 'ingredient_base_groups.csv'):
        if not path.is_file():
            parser.error(f'Missing file: {path}')

    return args


def load_ingredients(path, limit):
    """Process the most frequent ingredients first."""
    ingredients = sorted(read_rows(path), key=lambda row: -int(row['occurrences']))
    return ingredients[:limit] if limit else ingredients


def load_group_names():
    return {
        int(row['base_group_id']): row['canonical_name']
        for row in read_rows(ROOT / 'ingredient_base_groups.csv')
    }


def load_model(model_path, group_names, force_cpu):
    """Load the tokenizer, classifier and its mapping to real group IDs."""
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    device = torch.device('cuda' if torch.cuda.is_available() and not force_cpu else 'cpu')
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        model_path, local_files_only=True
    ).to(device)
    model.eval()

    # Model output indices are not the same as database group IDs.
    label_to_group = {int(index): int(group) for index, group in model.config.id2label.items()}
    group_ids = set(label_to_group.values())
    if (
        set(label_to_group) != set(range(model.config.num_labels))
        or len(group_ids) != len(label_to_group)
        or not group_ids.issubset(group_names)
        or len(label_to_group) < 3
    ):
        raise ValueError('Model label mapping does not match the base-group dictionary')

    return tokenizer, model, device, label_to_group


def review_status(text, score, margin, threshold, min_margin, truncated=False):
    """Reject complex or truncated text even if the model is confident."""
    if truncated or COMPLEX_PATTERN.search(text):
        return 'complex_review'
    if score >= threshold and margin >= min_margin:
        return 'high_confidence_review'
    return 'low_confidence_review'


def predict_batch(batch, tokenizer, model, device, max_length):
    """Return the three best classes and original token lengths for a batch."""
    texts = [row['ingredient'] for row in batch]

    # Check original lengths so truncated inputs cannot be accepted as safe atoms.
    lengths = tokenizer(
        texts, truncation=False, padding=False, return_length=True, verbose=False
    )['length']
    inputs = tokenizer(
        texts, padding=True, truncation=True, max_length=max_length, return_tensors='pt'
    )
    inputs = {name: tensor.to(device) for name, tensor in inputs.items()}

    logits = model(**inputs).logits
    probabilities = logits.float().softmax(dim=-1)
    scores, indices = probabilities.topk(3, dim=-1)

    return scores.cpu().tolist(), indices.cpu().tolist(), lengths


def make_prediction(ingredient, scores, indices, length, label_to_group, group_names, args):
    """Build a CSV record with top-three labels, confidence and review status."""
    confidence = scores[0]
    margin = confidence - scores[1]
    truncated = length > args.max_length
    status = review_status(
        ingredient['ingredient'], confidence, margin, args.score, args.margin, truncated
    )
    prediction = {
        'ingredient': ingredient['ingredient'],
        'occurrences': int(ingredient['occurrences']),
        'status': status,
        'confidence': confidence,
        'margin': margin,
        'truncated': truncated,
        'approved_group_id': '',
        'review_note': '',
    }

    for rank, (score, index) in enumerate(zip(scores, indices), start=1):
        group_id = label_to_group[index]
        prediction[f'group_id_{rank}'] = group_id
        prediction[f'group_name_{rank}'] = group_names[group_id]
        prediction[f'score_{rank}'] = score

    return prediction


class PredictionStatistics:
    """Count predictions, occurrences and keep a random sample per status."""

    def __init__(self, min_margin, sample_size, seed):
        self.min_margin = min_margin
        self.sample_size = sample_size
        self.random = random.Random(seed)
        self.counts = Counter()
        self.mentions = Counter()
        self.threshold_counts = Counter()
        self.threshold_mentions = Counter()
        self.samples = {}

    def add(self, prediction):
        status = prediction['status']
        occurrences = prediction['occurrences']
        self.counts[status] += 1
        self.mentions[status] += occurrences

        # Count threshold coverage separately from the selected confidence cutoff.
        if status != 'complex_review' and prediction['margin'] >= self.min_margin:
            for threshold in THRESHOLDS:
                if prediction['confidence'] >= threshold:
                    self.threshold_counts[threshold] += 1
                    self.threshold_mentions[threshold] += occurrences

        self.add_sample(status, prediction)

    def add_sample(self, status, prediction):
        """Reservoir sampling: keep a uniform sample without storing every row."""
        sample = self.samples.setdefault(status, [])
        if len(sample) < self.sample_size:
            sample.append(prediction)
        elif self.sample_size:
            index = self.random.randrange(self.counts[status])
            if index < self.sample_size:
                sample[index] = prediction

    def report(self, args, device, number_of_classes, number_of_ingredients):
        return {
            'device': str(device),
            'classes': number_of_classes,
            'ingredients': number_of_ingredients,
            'occurrences': sum(self.mentions.values()),
            'score_threshold': args.score,
            'margin_threshold': args.margin,
            'status_counts': dict(self.counts),
            'status_occurrences': dict(self.mentions),
            'thresholds': [
                {
                    'score': threshold,
                    'count': self.threshold_counts[threshold],
                    'occurrences': self.threshold_mentions[threshold],
                }
                for threshold in THRESHOLDS
            ],
            'note': ('Unlabelled data: confidence and coverage only, '
                     'not measured accuracy. No automatic approvals.'),
        }


def export_predictions(ingredients, tokenizer, model, device, label_to_group, group_names, args):
    """Run inference, write predictions and collect statistics batch by batch."""
    import torch

    stats = PredictionStatistics(args.margin, args.sample_size, args.seed)
    all_path = args.output / 'bert_predictions.csv'
    high_path = args.output / 'high_confidence.csv'

    with (
        all_path.open('w', encoding='utf-8-sig', newline='') as all_file,
        high_path.open('w', encoding='utf-8-sig', newline='') as high_file,
        torch.inference_mode(),
    ):
        writer = csv.DictWriter(all_file, PREDICTION_FIELDS)
        high_writer = csv.DictWriter(high_file, PREDICTION_FIELDS)
        writer.writeheader()
        high_writer.writeheader()

        for start in range(0, len(ingredients), args.batch_size):
            batch = ingredients[start:start + args.batch_size]
            scores, indices, lengths = predict_batch(
                batch, tokenizer, model, device, args.max_length
            )

            for ingredient, row_scores, row_indices, length in zip(batch, scores, indices, lengths):
                prediction = make_prediction(
                    ingredient, row_scores, row_indices, length,
                    label_to_group, group_names, args
                )
                writer.writerow(prediction)
                if prediction['status'] == 'high_confidence_review':
                    high_writer.writerow(prediction)
                stats.add(prediction)

            done = start + len(batch)
            if start // 1000 != done // 1000 or done == len(ingredients):
                print(
                    f'{done:,}/{len(ingredients):,} | '
                    f'high confidence: {stats.counts["high_confidence_review"]:,}',
                    flush=True,
                )

    return stats


def export_review_sample(output, samples):
    with (output / 'manual_sample.csv').open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.DictWriter(file, PREDICTION_FIELDS)
        writer.writeheader()
        for sample in samples.values():
            writer.writerows(sample)


def export_statistics(output, report):
    text = json.dumps(report, indent=2)
    (output / 'bert_atoms_stats.json').write_text(text, encoding='utf-8')
    print(text, flush=True)


def main():
    args = parse_args()
    group_names = load_group_names()
    tokenizer, model, device, label_to_group = load_model(args.model, group_names, args.cpu)
    ingredients = load_ingredients(args.input, args.limit)
    args.output.mkdir(parents=True, exist_ok=True)

    print(
        f'Device: {device} | Classes: {len(label_to_group)} | '
        f'Ingredients: {len(ingredients):,}',
        flush=True,
    )

    stats = export_predictions(
        ingredients, tokenizer, model, device, label_to_group, group_names, args
    )
    export_review_sample(args.output, stats.samples)
    report = stats.report(args, device, len(label_to_group), len(ingredients))
    export_statistics(args.output, report)


if __name__ == '__main__':
    main()
