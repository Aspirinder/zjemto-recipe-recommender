"""Offline ingredient normalization for ZjemTo.

1. prepare: extract individual ingredients from unresolved ingredient strings.
2. Run predict_ingredient_bert.py to classify the extracted atoms.
3. rebuild: combine the original mapping, aliases and predictions into recipe requirements.

This script uses only the Python standard library and does not modify PostgreSQL.
The classifier predictions are experimental, not verified ingredient labels.
"""

import argparse
import csv
import html
import json
import math
import re
import sqlite3
import unicodedata
from collections import Counter
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "output"
MAPPING = ROOT / "ingredient_mapping.csv"
MEMBERS = ROOT / "ingredient_base_group_members.csv"
BASES = ROOT / "ingredient_base_groups.csv"
ALIASES = ROOT / "ingredient_aliases_v3.csv"

# Text normalization rules. Do not match arbitrary substrings of product names.
NUM = r'(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])'

QTY = re.compile('^' + NUM + '(?:\\s*(?:to|-)\\s*' + NUM + ')?\\s+(?=\\S)', re.I)

UNIT = re.compile(
    r'^(?:cups?|tablespoons?|tbsp\.?|teaspoons?|tsp\.?|pounds?|lbs?\.?|ounces?|oz\.?|grams?|'
    r'g|kilograms?|kg|ml|liters?|litres?|pinch(?:es)?|handfuls?|stalks?|sprigs?|'
    r'slices?)\s+(?:of\s+)?',
    re.I,
)

PREP = (
    r'(?:finely |roughly |freshly |coarsely |thinly |thickly |very |well )?(?:chopped|diced|'
    r'minced|sliced|grated|shredded|crumbled|slivered|shaved|snipped|blanched|crushed|'
    r'peeled|softened|melted|drained|rinsed|smashed|halved|quartered|cubed|trimmed|seeded|'
    r'deseeded|pitted|stemmed|divided|sifted|beaten|whisked|julienned|torn|cut|'
    r'room temp(?:erature)?|at room temperature|toasted|browned|fried|ground(?: fine|'
    r' finely| coarse| coarsely)?)'
)

SUFFIX = re.compile('(?:,\\s*|\\s+)(?:' + PREP + ')\\s*$', re.I)

PREFIX = re.compile(
    r'^(?:(?:finely |roughly |freshly |coarsely |thinly )?(?:chopped|diced|minced|sliced|'
    r'grated|shredded|crumbled|slivered|shaved|snipped|blanched|crushed|peeled|softened|'
    r'melted|drained|rinsed|smashed|halved|quartered|cubed|trimmed|seeded|pitted|stemmed|'
    r'sifted|beaten|whisked)|fresh|raw|frozen|thawed|large|medium|small|extra large|baby|'
    r'boneless|skinless|packed|loosely packed|firmly packed|fat free|low fat|reduced fat|'
    r'low sodium|reduced sodium|unsalted|unsweetened|unseasoned|chilled)\s+',
    re.I,
)

PAREN_PREP = re.compile(
    r'\s*\(\s*(?:(?:finely |roughly |freshly |coarsely |thinly |thickly |very |'
    r'well )?(?:chopped|diced|minced|sliced|grated|shredded|crumbled|slivered|shaved|'
    r'snipped|blanched|crushed|peeled|softened|melted|drained|rinsed|smashed|halved|'
    r'quartered|cubed|trimmed|seeded|deseeded|pitted|stemmed|divided|sifted|beaten|whisked|'
    r'julienned|torn|cut|room temp(?:erature)?|at room temperature|toasted|browned|fried|'
    r'ground(?: fine| finely| coarse| coarsely)?)|for frying|for deep frying|for dredging|'
    r'for garnish|to garnish|to taste|as needed)\s*\)\s*$',
    re.I,
)

COMMA_QUALIFIER = re.compile(
    r',\s*(?:fresh|raw|frozen|thawed|large|medium|small|extra large|chilled|undiluted|'
    r'uncooked|slices|fresh ground|freshly ground|fresh squeezed|split lengthwise|'
    r'extra virgin)\s*$',
    re.I,
)

TRAIL = re.compile(
    r'(?:,?\s+)(?:to taste|as needed|as required|for garnish|to garnish|for serving|'
    r'for frying|for deep frying|for dredging|for drizzling|for brushing|for dusting)\s*$',
    re.I,
)

OPTIONAL = re.compile(r'(?:,\s*|\s+|\s*\(\s*)optional\)?\s*$', re.I)

SPICES = {'basil', 'oregano', 'thyme', 'rosemary', 'sage', 'parsley', 'dill', 'marjoram', 'tarragon', 'mint', 'cilantro', 'cumin', 'coriander', 'paprika', 'nutmeg', 'allspice', 'cinnamon', 'cardamom', 'clove', 'bay leaf', 'bay leaves', 'savory herb'}

CONNECT = re.compile(r'\s+(and/or|and|or|&)\s+', re.I)

# CSV helpers, legacy mapping conversion and alias resolution.

def canonical(s):
    """Normalize keys for matching the original mapping."""
    return ' '.join(str(s).casefold().replace('–', '-').replace('—', '-').replace('‑', '-').replace('-', ' ').split()).strip()

def parse_bool(v):
    """Read boolean values from CSV."""
    return str(v).strip().lower() in ('true', 't', '1', 'yes')

def db_setup(path):
    """Create or reset the temporary SQLite mapping index."""
    db = sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('PRAGMA synchronous=NORMAL')
    db.execute('CREATE TABLE IF NOT EXISTS exact (ingredient TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS normalized (ingredient TEXT PRIMARY KEY, payload TEXT, ambiguous INTEGER NOT NULL DEFAULT 0)')
    db.execute('DELETE FROM exact')
    db.execute('DELETE FROM normalized')
    db.commit()
    return db

def read_rows(path):
    """Stream CSV records without loading the entire file into memory."""
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        yield from csv.DictReader(f)

def require_columns(path, columns):
    """Fail early when a required CSV column is missing."""
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        header = csv.DictReader(f).fieldnames or []
    missing = set(columns) - set(header)
    if missing:
        raise ValueError(f'{path.name}: missing columns: {sorted(missing)}; found: {header}')

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

def parse_ingredient_parts(raw):
    """Read a JSON list of ingredients, keeping the original positions."""
    if isinstance(raw, list):
        parts = raw
    else:
        parts = json.loads(raw)
    if not isinstance(parts, list):
        raise ValueError('ingredient_parts must be JSON array')
    return [str(x).strip() if x is not None else '' for x in parts]

def semantic_key(raw):
    """Normalize Unicode, HTML entities, punctuation and whitespace."""
    s = unicodedata.normalize('NFKC', html.unescape(str(raw))).casefold()
    s = s.replace('’', "'").replace('‘', "'").replace('⁄', '/')
    s = re.sub('[‐‑‒–—−-]', ' ', s)
    s = re.sub('\\s+', ' ', s).strip(' \t\r\n,.;')
    return s

def singular(word):
    """Apply conservative singular forms for alias matching."""
    special = {'tomatoes': 'tomato', 'potatoes': 'potato', 'leaves': 'leaf', 'halves': 'half', 'loaves': 'loaf', 'cloves': 'clove', 'cherries': 'cherry', 'berries': 'berry'}
    if word in special:
        return special[word]
    if len(word) > 4 and word.endswith('ies'):
        return word[:-3] + 'y'
    if len(word) > 4 and word.endswith(('ches', 'shes', 'xes', 'sses', 'zzes')):
        return word[:-2]
    if len(word) > 3 and word.endswith('s') and (not word.endswith(('ss', 'us', 'is', 'ous'))):
        return word[:-1]
    return word

def singular_last(s):
    """Normalize only the last word of a multiword alias."""
    words = s.split()
    if not words:
        return s
    return ' '.join(words[:-1] + [singular(words[-1])])

def load_aliases(base_for):
    """Build exact and inflected alias dictionaries, rejecting conflicting IDs."""
    groups = {}
    for row in read_rows(BASES):
        bid = int(row['base_group_id'])
        if bid in groups:
            raise ValueError(f'Duplicate base group: {bid}')
        groups[bid] = row['canonical_name']
    ids = set(base_for.values())
    if ids != set(groups):
        raise ValueError('Base dictionary/member IDs do not match')
    candidates = {}
    for row in read_rows(ALIASES):
        bid = int(row['base_group_id'])
        if bid not in groups:
            raise ValueError(f'Unknown alias group: {bid}')
        key = semantic_key(row['alias'])
        if key:
            candidates.setdefault(key, set()).add(bid)
    exact = {k: next(iter(v)) for k, v in candidates.items() if len(v) == 1}
    conflicts = {k for k, v in candidates.items() if len(v) > 1}
    inflected = {}
    for key, ids in candidates.items():
        inflected.setdefault(singular_last(key), set()).update(ids)
    singulars = {k: next(iter(v)) for k, v in inflected.items() if len(v) == 1 and k not in conflicts}
    return (exact, singulars, conflicts, groups)

class Resolver:
    """Resolve known ingredient names and simple logical expressions using aliases."""

    def __init__(self, base_for):
        self.aliases, self.singulars, self.conflicts, self.groups = load_aliases(base_for)
        self.by_name = {name: gid for gid, name in self.groups.items()}

    def atom(self, text):
        # Try complete names first, then bounded preparation/quantity cleanup.
        seen = set()
        queue = [text]
        while queue and len(seen) < 32:
            candidate = queue.pop(0)
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            if candidate in self.conflicts:
                return None
            if candidate in self.aliases:
                return self.aliases[candidate]
            singular_name = singular_last(candidate)
            if singular_name in self.singulars:
                return self.singulars[singular_name]
            if any((character in candidate for character in (';', ':', '?', '!', '/', '&'))) and (not QTY.match(candidate)):
                continue
            quantity = QTY.sub('', candidate, count=1)
            if quantity != candidate:
                queue.append(UNIT.sub('', quantity, count=1))
                queue.append(quantity)
            dry = re.sub('^(?:dry|dried|ground)\\s+', '', candidate, count=1)
            dry = re.sub(',\\s*(?:dry|dried|ground)$', '', dry)
            if dry != candidate and dry in SPICES:
                queue.append(dry)
            # Cooked rice, chicken and ham are distinct products.
            if candidate.startswith('cooked '):
                raw = candidate[7:]
                group_id = self.aliases.get(raw, self.singulars.get(singular_last(raw)))
                if group_id == self.by_name.get('rice'):
                    return self.by_name['cooked rice']
                if group_id == self.by_name.get('chicken'):
                    return self.by_name['cooked chicken']
                if group_id == self.by_name.get('ham'):
                    return self.by_name['cooked ham']
            if candidate.endswith(', cooked'):
                queue.append('cooked ' + candidate[:-8].strip())
            for rule in (PAREN_PREP, TRAIL, COMMA_QUALIFIER, SUFFIX, PREFIX):
                cleaned = rule.sub('', candidate, count=1).strip(' ,.;')
                if cleaned != candidate and cleaned:
                    queue.append(cleaned)
            cleaned = re.sub(',\\s*' + PREP + '\\s+and\\s+' + PREP + '\\s*$', '', candidate).strip(' ,.;')
            if cleaned != candidate and cleaned:
                queue.append(cleaned)
        return None

    def infer(self, raw):
        text = semantic_key(raw)
        optional = bool(OPTIONAL.search(text))
        if optional:
            text = OPTIONAL.sub('', text).strip(' ,.;')
        # A known compound product name takes priority over AND/OR splitting.
        group_id = self.atom(text)
        if group_id is not None:
            return (([[group_id]], optional), 'alias_v3')
        text = re.sub('\\s*\\(\\s*or\\s+([^()]+)\\)\\s*$', ' or \\1', text)
        if text in ('salt, pepper', 'salt, and pepper'):
            text = 'salt and pepper'
        if '(' in text or ')' in text:
            return (None, 'unresolved_parentheses')
        pieces = CONNECT.split(text)
        if len(pieces) < 3:
            return (None, 'no_safe_alias')
        operators = [item if item != '&' else 'and' for item in pieces[1::2]]
        if 'and/or' in operators or len(set(operators)) != 1:
            return (None, 'mixed_boolean_expression')
        if len(pieces) > 15:
            return (None, 'too_many_alternatives')
        group_ids = [self.atom(item.strip()) for item in pieces[::2]]
        if any((item is None for item in group_ids)):
            return (None, 'unresolved_boolean_part')
        if operators[0] == 'or':
            requirements = [sorted(set(group_ids))]
        else:
            requirements = [[item] for item in dict.fromkeys(group_ids)]
        return ((requirements, optional), 'boolean_v3')

# V5 parsing rules for previously unresolved ingredient strings.

NOTE = (
    r'(?:finely |roughly |freshly |coarsely |thinly )?(?:chopped|diced|minced|sliced|grated|'
    r'shredded|peeled|softened|melted|drained|rinsed|divided|cubed|trimmed|pitted|'
    r'room temp(?:erature)?|at room temperature|to taste|for garnish|as needed)'
)

NOTE_END = re.compile(',\\s*' + NOTE + '\\s*$', re.I)

NOTE_PAREN = re.compile('\\(\\s*' + NOTE + '\\s*\\)', re.I)

SIZE_PAREN = re.compile(
    r'\(\s*\d+(?:\.\d+)?\s*(?:g|grams?|kg|ml|oz|ounces?|cups?|tbsp|tsp|tablespoons?|'
    r'teaspoons?)\s*\)',
    re.I,
)

BLOCK = re.compile('[()/;\\[\\]&+,!:?]|\\b(?:and|or|with|plus|except|if|optional|substitute|either)\\b', re.I)

TOOLS = {'aluminum foil', 'aluminium foil', 'toothpick', 'toothpicks', 'parchment paper', 'plastic wrap', 'wax paper', 'reynolds wrap foil'}

@lru_cache(maxsize=100000)
def parse(raw):
    """Split a safe expression into single, AND or OR atoms; reject ambiguous structures."""
    text = semantic_key(raw)
    optional = bool(OPTIONAL.search(text))
    if optional:
        text = OPTIONAL.sub('', text).strip(' ,.;')
    if text in TOOLS:
        return ('equipment', (), optional)
    text = NOTE_PAREN.sub(' ', text)
    text = SIZE_PAREN.sub(' ', text)
    text = re.sub('\\(\\s*(?:canned|frozen|dried|cooked|uncooked)\\s*\\)', lambda m: ' ' + m[0][1:-1].strip() + ' ', text)
    for _ in range(8):
        previous = text
        text = NOTE_END.sub('', text).strip(' ,.;')
        if text == previous:
            break
    text = re.sub('\\s*\\(\\s*or\\s+([^()]+)\\)\\s*$', ' or \\1', text)
    text = re.sub('\\s+', ' ', text).strip(' ,.;')
    text = re.sub('\\s+to taste$', '', text).strip()
    if text in ('salt, pepper', 'salt, and pepper', 'salt, black pepper'):
        text = text.replace(', and ', ' and ').replace(', ', ' and ')
    pieces = CONNECT.split(text)
    operators = [x if x != '&' else 'and' for x in pieces[1::2]]
    if optional and operators:
        return ('blocked', (), False)
    if len(set(operators)) > 1 or 'and/or' in operators or len(pieces) > 15:
        return ('blocked', (), optional)
    atoms = []
    for part in pieces[::2]:
        part = part.strip(' ,.;')
        without_quantity = QTY.sub('', part, count=1)
        if without_quantity != part:
            part = UNIT.sub('', without_quantity, count=1).strip()
        if not part or BLOCK.search(part):
            return ('blocked', (), optional)
        atoms.append(part)
    return (operators[0] if operators else 'single', tuple(atoms), optional)

def prepare(path):
    counts = Counter()
    stats = Counter()
    for row in read_rows(path):
        kind, atoms, _ = parse(row['ingredient'])
        stats[kind] += 1
        for atom in set(atoms):
            counts[atom] += int(row['occurrences'])
    with (OUT / 'atoms.csv').open('w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['ingredient', 'occurrences'])
        writer.writerows(counts.most_common())
    print(json.dumps({'parse_types': dict(stats), 'unique_atoms': len(counts)}, indent=2))

# Store exact and normalized mappings separately. Conflicting normalized
# names are deliberately rejected, rather than choosing a random label.
INSERT_EXACT = 'INSERT OR REPLACE INTO exact VALUES (?,?)'
INSERT_NORMALIZED = '''
    INSERT INTO normalized VALUES (?,?,0)
    ON CONFLICT(ingredient) DO UPDATE SET
        ambiguous = CASE
            WHEN normalized.payload = excluded.payload
                 AND normalized.ambiguous = 0 THEN 0 ELSE 1 END,
        payload = CASE
            WHEN normalized.payload = excluded.payload
                 AND normalized.ambiguous = 0 THEN normalized.payload
            ELSE NULL END
'''


def save_mapping_batch(db, exact_rows, normalized_rows):
    with db:
        db.executemany(INSERT_EXACT, exact_rows)
        db.executemany(INSERT_NORMALIZED, normalized_rows)


def build_lookup(recipes_path):
    """Build the local dictionary index and return a cached lookup function."""
    for path in (recipes_path, MAPPING, MEMBERS, BASES, ALIASES):
        if not path.is_file():
            raise FileNotFoundError(f'Required file missing: {path}')

    require_columns(recipes_path, ['recipe_id', 'ingredient_parts'])
    require_columns(MAPPING, ['ingredient', 'group_requirements', 'is_optional'])
    require_columns(MEMBERS, ['group_id', 'base_group_id'])

    base_for = {
        int(row['group_id']): int(row['base_group_id'])
        for row in read_rows(MEMBERS)
    }
    print('Group members:', len(base_for), flush=True)
    resolver = Resolver(base_for)
    print(f'Alias names: {len(resolver.aliases):,}; '
          f'ambiguous: {len(resolver.conflicts):,}', flush=True)

    db = db_setup(OUT / 'mapping_index.sqlite3')
    exact_rows = []
    normalized_rows = []
    seen = valid = 0

    for row in read_rows(MAPPING):
        name = (row.get('ingredient') or '').strip()
        if not name:
            continue
        seen += 1
        try:
            groups = parse_groups(row, base_for)
        except (ValueError, TypeError):
            continue
        if groups is None:
            continue

        payload = json.dumps(
            [groups, parse_bool(row.get('is_optional'))],
            separators=(',', ':'),
        )
        valid += 1
        exact_rows.append((name, payload))
        normalized_rows.append((canonical(name), payload))

        if len(exact_rows) >= 10000:
            save_mapping_batch(db, exact_rows, normalized_rows)
            exact_rows.clear()
            normalized_rows.clear()

    save_mapping_batch(db, exact_rows, normalized_rows)
    print(f'Mapping rows: {seen:,}; valid: {valid:,}', flush=True)
    exact_cursor = db.cursor()
    normalized_cursor = db.cursor()

    def find_normalized(name):
        return normalized_cursor.execute(
            'SELECT payload, ambiguous FROM normalized WHERE ingredient=?',
            (canonical(name),),
        ).fetchone()

    @lru_cache(maxsize=150000)
    def lookup(name):
        # 1. Original, exact mapping has priority.
        match = exact_cursor.execute(
            'SELECT payload FROM exact WHERE ingredient=?', (name,)
        ).fetchone()
        if match:
            return json.loads(match[0]), 'exact'

        # 2. Try a normalized key, but never accept an ambiguous mapping.
        match = find_normalized(name)
        if match:
            if match[1]:
                return None, 'ambiguous_old_mapping'
            if match[0]:
                return json.loads(match[0]), 'normalized'

        # 3. Try a limited set of safe text cleanup rules.
        text = semantic_key(name)
        if not CONNECT.search(text):
            forms = []
            without_quantity = QTY.sub('', text, count=1)
            if without_quantity != text:
                forms.extend([
                    UNIT.sub('', without_quantity, count=1), without_quantity
                ])
            for rule in (PAREN_PREP, TRAIL, COMMA_QUALIFIER, SUFFIX, PREFIX):
                cleaned = rule.sub('', text, count=1).strip(' ,.;')
                if cleaned != text and cleaned:
                    forms.append(cleaned)

            known = set()
            for form in dict.fromkeys(forms):
                match = find_normalized(form)
                if match and not match[1] and match[0]:
                    known.add(match[0])
            if len(known) > 1:
                return None, 'ambiguous_cleaned_mapping'
            if known:
                return json.loads(next(iter(known))), 'cleaned_mapping_v3'

        # 4. Whole-name aliases and simple logical expressions.
        return resolver.infer(name)

    return db, lookup, resolver


def load_predictions(path, valid_groups, min_score, min_margin):
    """Accept only eligible, untruncated, non-conflicting model predictions."""
    predictions = {}
    conflicts = set()
    for row in read_rows(path):
        try:
            group_id = int(row['group_id_1'])
            score = float(row['confidence'])
            margin = float(row['margin'])
        except (ValueError, TypeError):
            continue

        if (
            group_id not in valid_groups
            or not math.isfinite(score)
            or not math.isfinite(margin)
            or not min_score <= score <= 1
            or not min_margin <= margin <= 1
            or row['truncated'].lower() not in ('false', '0', 'no')
            or row['status'] == 'complex_review'
        ):
            continue

        name = row['ingredient']
        prediction = (group_id, score)
        if name in predictions and predictions[name] != prediction:
            conflicts.add(name)
        predictions[name] = prediction

    for name in conflicts:
        predictions.pop(name, None)
    return predictions


def create_ingredient_resolver(lookup, predictions):
    """Combine known mappings, the V5 parser and model predictions."""
    @lru_cache(maxsize=150000)
    def resolve(raw):
        value, method = lookup(raw)
        if value is not None:
            return (*value, 'v3', None, False)
        if method.startswith('ambiguous'):
            return [], False, 'unresolved_complex', None, True

        kind, atoms, optional = parse(raw)
        if kind == 'equipment':
            return [], True, 'equipment', None, False
        if kind == 'blocked':
            return [], False, 'unresolved_complex', None, True

        group_ids = []
        scores = []
        for atom in atoms:
            value, method = lookup(atom)
            if value is not None:
                requirements, _ = value
                if len(requirements) != 1 or len(requirements[0]) != 1:
                    return [], optional, 'unresolved_complex', None, True
                group_ids.append(requirements[0][0])
                continue

            # The model is a fallback for individual, unambiguous atoms only.
            hit = predictions.get(atom) if not method.startswith('ambiguous') else None
            if hit is None:
                if kind == 'single':
                    return [], optional, 'unresolved_single', None, False
                return [], optional, 'unresolved_complex', None, True
            group_ids.append(hit[0])
            scores.append(hit[1])

        # Each inner list is OR; the outer list is AND.
        if kind == 'or':
            requirements = [sorted(set(group_ids))]
        else:
            requirements = [[group_id] for group_id in dict.fromkeys(group_ids)]
        source = 'bert_v5' if scores else 'parser_v5'
        confidence = min(scores) if scores else None
        return requirements, optional, source, confidence, False

    return resolve


OUTPUT_COLUMNS = [
    'recipe_id', 'ingredient_position', 'ingredient_original',
    'group_requirements', 'is_optional', 'is_unresolved', 'is_blocked',
    'mapping_source', 'confidence',
]


def export_requirements(recipes_path, output_path, resolve):
    """Write one row per original ingredient, including unresolved rows."""
    counts = Counter()
    methods = Counter()
    histogram = Counter()
    with output_path.open('w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(OUTPUT_COLUMNS)
        for recipe in read_rows(recipes_path):
            counts['recipes_total'] += 1
            try:
                parts = parse_ingredient_parts(recipe['ingredient_parts'])
            except (ValueError, TypeError):
                counts['invalid_json'] += 1
                continue

            rows = []
            unknown_required = 0
            blocked = False
            known_required = 0
            any_bert = False
            unresolved_all = 0

            for position, raw in enumerate(parts):
                if raw:
                    req, optional, source, confidence, block = resolve(raw)
                else:
                    req, optional, source, confidence, block = (
                        [], False, 'unresolved_complex', None, True
                    )
                unresolved = source.startswith('unresolved')
                unresolved_all += unresolved
                methods[source] += 1
                unknown_required += int(unresolved and not optional)
                blocked |= block and not optional
                known_required += int(bool(req) and not optional)
                any_bert |= source == 'bert_v5'

                rows.append([
                    recipe['recipe_id'], position, raw,
                    json.dumps(req, separators=(',', ':')),
                    str(optional).lower(), str(unresolved).lower(),
                    str(block).lower(), source,
                    '' if confidence is None else confidence,
                ])

            writer.writerows(rows)
            counts['rows_written'] += len(rows)
            if parts and not unresolved_all:
                counts['complete_all_rows'] += 1
            if (known_required or unknown_required) and not blocked:
                histogram[unknown_required] += 1
                if not unknown_required:
                    counts['complete_required'] += 1
                if any_bert:
                    counts['eligible_with_bert'] += 1
            if blocked:
                counts['blocked_recipes'] += 1
            if counts['recipes_total'] % 25000 == 0:
                print(f"Recipes {counts['recipes_total']:,} | "
                      f"complete {counts['complete_all_rows']:,}", flush=True)

    return counts, methods, histogram


def rebuild(args):
    """Rebuild the final CSV and write coverage statistics."""
    require_columns(args.predictions, [
        'ingredient', 'group_id_1', 'confidence', 'margin', 'truncated', 'status'
    ])
    db, lookup, resolver = build_lookup(args.recipes)
    try:
        predictions = load_predictions(
            args.predictions, resolver.groups, args.score, args.margin
        )
        resolve = create_ingredient_resolver(lookup, predictions)
        counts, methods, histogram = export_requirements(
            args.recipes, OUT / 'recipe_ingredient_requirements_v5.csv', resolve
        )
    finally:
        db.close()

    report = {
        **counts,
        'methods': dict(methods),
        'confidence': args.score,
        'eligible_atom_predictions': len(predictions),
        'unknown_required_histogram': dict(sorted(histogram.items())),
        'potential_recipes_by_unknown_budget': {
            str(i): sum(n for k, n in histogram.items() if k <= i)
            for i in range(3)
        },
        'note': ('Experimental labels. Budget counts unresolved single ingredient '
                 'lines, before known missing requirements, not actual fridge '
                 'matches. Unresolved complex mandatory rows block eligibility.'),
    }
    (OUT / 'stats_v5.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


def main():
    global OUT
    csv.field_size_limit(2**31 - 1)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'rebuild'])
    parser.add_argument('--input', type=Path, default=ROOT / 'unmapped_unique_v3.csv')
    parser.add_argument('--recipes', type=Path, default=ROOT / 'recipes_v2.csv')
    parser.add_argument('--predictions', type=Path, default=ROOT / 'output' / 'bert_predictions.csv')
    parser.add_argument('--output', type=Path, default=OUT,
                        help='Use a separate directory to verify a rebuild safely.')
    parser.add_argument('--score', type=float, default=0.90)
    parser.add_argument('--margin', type=float, default=0.10)
    args = parser.parse_args()
    if not 0 <= args.score <= 1 or not 0 <= args.margin <= 1:
        parser.error('Invalid thresholds')
    OUT = args.output
    OUT.mkdir(parents=True, exist_ok=True)
    if args.stage == 'prepare':
        prepare(args.input)
    else:
        rebuild(args)


if __name__ == '__main__':
    main()
