import { ingredients, recipes } from './data.ts';
import { ingredientPl } from './ingredientsPl.ts';
import type { Diet, Meal, Recipe, RecipeIngredient } from './types.ts';

const MEAT = new Set(['bacon', 'chicken', 'salmon']);
const ANIMAL = new Set(['bacon', 'chicken', 'salmon', 'eggs', 'parmesan', 'feta', 'milk', 'butter', 'cream', 'cottage', 'honey']);
const GLUTEN = new Set(['spaghetti', 'flour']);

// Local recipes only — recipes from the API are already filtered by the backend.
const allergenMap: Record<string, readonly string[]> = {
  gluten: ['spaghetti', 'flour', 'soy'],
  dairy: ['parmesan', 'feta', 'milk', 'butter', 'cream', 'cottage'],
  eggs: ['eggs'],
  nuts: [],
  seafood: ['salmon'],
};

function blockedIngredients(diet: Diet, allergies: readonly string[]) {
  const blocked = new Set<string>();
  if (diet === 'wegetarianska') MEAT.forEach((id) => blocked.add(id));
  if (diet === 'weganska') ANIMAL.forEach((id) => blocked.add(id));
  if (diet === 'bez-glutenu') GLUTEN.forEach((id) => blocked.add(id));
  for (const allergy of allergies) {
    for (const id of allergenMap[allergy] ?? []) blocked.add(id);
  }
  return blocked;
}

export function recipeFits(recipe: Recipe, diet: Diet, allergies: readonly string[], meals: readonly Meal[]) {
  if (meals.length > 0 && !meals.includes(recipe.meal)) return false;
  const blocked = blockedIngredients(diet, allergies);
  return !recipe.ingredients.some((item) => blocked.has(item.id));
}

const byId = new Map(ingredients.map((item) => [item.id, item]));

export function ingredientById(id: string) {
  return byId.get(id);
}

export function ingredientName(item: RecipeIngredient) {
  // Recipe ingredients from Food.com are English; use the Polish name when the dictionary has this exact one.
  return ingredientById(item.id)?.name ?? (item.name ? ingredientPl(item.name) : item.id);
}

// Words that don't change what the product is: "fresh basil" is basil, "large eggs" are eggs.
const DESCRIPTORS = new Set([
  'fresh', 'large', 'small', 'medium', 'chopped', 'minced', 'diced', 'sliced', 'boneless', 'skinless',
  'whole', 'raw', 'ripe', 'finely', 'grated', 'shredded', 'peeled', 'organic', 'extra', 'jumbo',
]);

function singular(word: string) {
  if (/(oes|ches|shes|sses)$/.test(word)) return word.slice(0, -2);
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * "Fresh Basil Leaves (optional)" and "basil leaf" -> "basil leaf".
 * `strict` keeps descriptive words: then only spelling variants match ("sun-dried tomatoes" / "sun dried tomato").
 */
export function productKey(name: string, strict = false) {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/-/g, ' ')
    .split(/[^a-z]+/)
    .filter((word) => word && (strict || !DESCRIPTORS.has(word)))
    .map(singular)
    .join(' ');
}

export function splitIngredients(recipe: Recipe, fridge: readonly string[]) {
  const owned = new Set(fridge);
  // Products outside the local catalog are `x:<name>`; compare them by name, ignoring "fresh", plurals etc.
  const ownedNames = new Set(fridge.filter((id) => id.startsWith('x:')).map((id) => productKey(id.slice(2))));
  const have: RecipeIngredient[] = [];
  const missing: RecipeIngredient[] = [];
  for (const item of recipe.ingredients) {
    const byName = item.id.startsWith('x:') && ownedNames.size > 0 && ownedNames.has(productKey(item.id.slice(2)));
    if (item.staple || owned.has(item.id) || byName) have.push(item);
    else missing.push(item);
  }
  return { have, missing, total: recipe.ingredients.length };
}

export function deckOrder(
  pool: readonly Recipe[],
  fridge: readonly string[],
  strict: boolean,
) {
  const ranked = pool
    .map((recipe, index) => {
      const parts = splitIngredients(recipe, fridge);
      const ratio = parts.total === 0 ? 1 : (parts.total - parts.missing.length) / parts.total;
      return { recipe, index, missing: parts.missing.length, ratio };
    })
    .filter((item) => !(strict && fridge.length > 0 && item.missing > 0));

  if (fridge.length === 0) return ranked.map((item) => item.recipe);

  return ranked
    .sort((a, b) => b.ratio - a.ratio || a.missing - b.missing || a.index - b.index)
    .map((item) => item.recipe);
}

function lovedScore(recipe: Recipe, loved: ReadonlySet<string>) {
  let score = 0;
  for (const item of recipe.ingredients) {
    if (loved.has(item.id)) score += 1;
  }
  return score;
}

export function visibleDeck(
  source: readonly Recipe[],
  fridge: readonly string[],
  liked: readonly string[],
  passed: readonly string[],
  strict: boolean,
  loved: readonly string[] = [],
  avoided: readonly string[] = [],
  meals: readonly Meal[] = [],
  diet: Diet = 'wszystko',
  allergies: readonly string[] = [],
) {
  const hidden = new Set([...liked, ...passed]);
  const avoid = new Set(avoided);
  const pool = source.filter((recipe) => {
    if (hidden.has(recipe.id)) return false;
    if (!recipeFits(recipe, diet, allergies, meals)) return false;
    return !recipe.ingredients.some((item) => avoid.has(item.id));
  });
  const ordered = deckOrder(pool, fridge, strict);
  const love = new Set(loved);
  if (love.size === 0) return ordered;
  return ordered
    .map((recipe, index) => ({ recipe, index, score: lovedScore(recipe, love) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.recipe);
}

export type Unlock = {
  ingredientId: string;
  recipeIds: string[];
};

export function unlockSuggestions(pool: readonly Recipe[], fridge: readonly string[]) {
  const buckets = new Map<string, string[]>();
  for (const recipe of pool) {
    const { missing } = splitIngredients(recipe, fridge);
    if (missing.length !== 1) continue;
    const id = missing[0]?.id;
    if (!id) continue;
    const current = buckets.get(id) ?? [];
    current.push(recipe.id);
    buckets.set(id, current);
  }
  return [...buckets.entries()]
    .map(([ingredientId, recipeIds]) => ({ ingredientId, recipeIds }))
    .sort((a, b) => b.recipeIds.length - a.recipeIds.length);
}

export function countMatches(pool: readonly Recipe[], fridge: readonly string[]) {
  if (fridge.length === 0) return { ready: 0, almost: 0 };
  let ready = 0;
  let almost = 0;
  for (const recipe of pool) {
    const missing = splitIngredients(recipe, fridge).missing.length;
    if (missing === 0) ready += 1;
    else if (missing === 1) almost += 1;
  }
  return { ready, almost };
}

/** "Food.com · 30 min · łatwo" — parts that are unknown are skipped. */
export function recipeKicker(recipe: Recipe, withDifficulty = true) {
  return [recipe.cuisine, recipe.minutes > 0 ? `${recipe.minutes} min` : '', withDifficulty ? recipe.difficulty : '']
    .filter(Boolean)
    .join(' · ');
}

export function plural(count: number, one: string, few: string, many: string) {
  const abs = Math.abs(count);
  if (abs === 1) return one;
  const last = abs % 10;
  const hundred = abs % 100;
  if (last >= 2 && last <= 4 && (hundred < 12 || hundred > 14)) return few;
  return many;
}

export function formatClock(seconds: number) {
  const total = Math.ceil(Math.max(0, seconds) - 1e-9);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function assertRecipes() {
  for (const recipe of recipes) {
    for (const item of recipe.ingredients) {
      if (!byId.has(item.id)) {
        throw new Error(`W przepisie „${recipe.title}” nie ma produktu ${item.id}`);
      }
    }
    if (recipe.steps.length === 0) {
      throw new Error(`Przepis „${recipe.title}” nie ma kroków`);
    }
  }
}

/** Identifies a fridge search (selected groups + max_missing), to tell whether shown results are outdated. */
export function fridgeKey(pantry: readonly { id: number }[], maxMissing: number) {
  return `${pantry.map((group) => group.id).sort((a, b) => a - b).join(',')}|${maxMissing}`;
}

/** Selected groups merged into products: "walnut" + "walnuts" is one product (shown once, removed together). */
export function pantryProducts<T extends { id: number; name: string }>(pantry: readonly T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const group of pantry) {
    const key = productKey(group.name, true) || group.name;
    byKey.set(key, [...(byKey.get(key) ?? []), group]);
  }
  return [...byKey.values()];
}
