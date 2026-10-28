import { ingredients, recipes } from './data.ts';
import type { Recipe, RecipeIngredient } from './types.ts';

const byId = new Map(ingredients.map((item) => [item.id, item]));

export function ingredientById(id: string) {
  return byId.get(id);
}

export function recipeById(id: string) {
  return recipes.find((recipe) => recipe.id === id);
}

export function splitIngredients(recipe: Recipe, fridge: readonly string[]) {
  const owned = new Set(fridge);
  const have: RecipeIngredient[] = [];
  const missing: RecipeIngredient[] = [];
  for (const item of recipe.ingredients) {
    if (owned.has(item.id)) have.push(item);
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

export function visibleDeck(
  fridge: readonly string[],
  liked: readonly string[],
  passed: readonly string[],
  strict: boolean,
) {
  const hidden = new Set([...liked, ...passed]);
  return deckOrder(
    recipes.filter((recipe) => !hidden.has(recipe.id)),
    fridge,
    strict,
  );
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

export function countMatches(fridge: readonly string[]) {
  if (fridge.length === 0) return { ready: 0, almost: 0 };
  let ready = 0;
  let almost = 0;
  for (const recipe of recipes) {
    const missing = splitIngredients(recipe, fridge).missing.length;
    if (missing === 0) ready += 1;
    else if (missing === 1) almost += 1;
  }
  return { ready, almost };
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
