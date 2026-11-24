import type { Recipe, RecipeIngredient, RecipeStep } from './types.ts';

// Address of the ZjemTo FastAPI backend (see .env.example). The backend allows any origin (CORS),
// so the browser talks to it directly. Without VITE_API_URL the deployed Azure API is used.
const DEFAULT_API = 'https://zjemto-api.azurewebsites.net';
const BASE = ((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API).replace(/\/$/, '');

// A sleeping Azure instance needs ~15–30 s to start.
const TIMEOUT_MS = 60_000;
// The personalized feed additionally waits for the ML service (45 s timeout on the backend) — cold start + ML.
const FEED_TIMEOUT_MS = 90_000;

/** Lists come as JSON arrays (API v7) or as R/CSV text: c("a", "b") / "a", "b" (older versions). */
type ApiList = string[] | string | null;

export type ApiRecipe = {
  recipe_id: number;
  name: string | null;
  image_url: string | null;
  ingredient_parts: ApiList;
  total_time: string | number | null;
  description?: string | null;
  category?: string | null;
  ingredient_quantities?: ApiList;
  instructions?: ApiList;
  calories?: number | null;
  protein?: number | null;
  fat?: number | null;
  carbs?: number | null;
};

export type Feed = {
  mode: 'calibration' | 'personalized';
  isCalibrated: boolean;
  /** Only in calibration mode. */
  progress: { current: number; required: number } | null;
  recipes: Recipe[];
};

export type SwipeResult = {
  status: 'success' | 'already_recorded';
  is_calibrated: boolean;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = (await response.json()) as { detail?: unknown };
        if (typeof data.detail === 'string') detail = data.detail;
        else if (data.detail !== undefined) detail = JSON.stringify(data.detail);
      } catch {
        // body was not JSON
      }
      throw new ApiError(response.status, detail);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Network error, CORS or timeout — status 0 means "no answer from the server".
    throw new ApiError(0, error instanceof Error ? error.message : String(error));
  } finally {
    window.clearTimeout(timer);
  }
}

const userPath = (userId: string) => encodeURIComponent(userId);

/** After a pause the Azure instance cold-starts (~15–30 s). Ping it early so it is warm by the time the user submits. */
let wakePromise: Promise<void> | null = null;
export function wakeServer(): Promise<void> {
  wakePromise ??= request<unknown>('GET', '/').then(
    () => undefined,
    () => {
      wakePromise = null;
    },
  );
  return wakePromise;
}

/** Calls `onSlow` if `promise` hasn't settled after `ms`; returns a cancel function. */
export function whenSlow(promise: Promise<unknown>, ms: number, onSlow: () => void) {
  const timer = window.setTimeout(onSlow, ms);
  const cancel = () => window.clearTimeout(timer);
  promise.then(cancel, cancel);
  return cancel;
}

export async function signUp(email: string, password: string): Promise<string> {
  const data = await request<{ user_id: string | number }>('POST', '/api/users/signup', {
    user_email: email,
    user_password: password,
  });
  return String(data.user_id);
}

export async function signIn(email: string, password: string): Promise<string> {
  const data = await request<{ user_id: string | number }>('POST', '/api/users/signin', {
    user_email: email,
    user_password: password,
  });
  return String(data.user_id);
}

export async function getAllergies(userId: string): Promise<string[]> {
  const data = await request<{ allergies: string[] | null }>('GET', `/api/users/${userPath(userId)}/allergies`);
  return data.allergies ?? [];
}

/** Replaces the whole list on the server. */
export async function putAllergies(userId: string, allergies: string[]): Promise<string[]> {
  const data = await request<{ allergies: string[] | null }>('PUT', `/api/users/${userPath(userId)}/allergies`, {
    allergies,
  });
  return data.allergies ?? [];
}

export async function getFeed(userId: string): Promise<Feed> {
  const data = await request<{
    mode: 'calibration' | 'personalized';
    is_calibrated: boolean;
    calibration_progress?: { current_swipes: number; total_required: number };
    recipes: ApiRecipe[] | null;
  }>('GET', `/api/recipes/feed/${userPath(userId)}`, undefined, FEED_TIMEOUT_MS);
  return {
    mode: data.mode,
    isCalibrated: data.is_calibrated,
    progress: data.calibration_progress
      ? { current: data.calibration_progress.current_swipes, required: data.calibration_progress.total_required }
      : null,
    recipes: (data.recipes ?? []).map(toRecipe),
  };
}

/** API v7: recipes liked by the user, newest first. */
export async function getLikedRecipes(userId: string): Promise<Recipe[]> {
  const data = await request<{ recipes: ApiRecipe[] | null }>('GET', `/api/users/${userPath(userId)}/liked-recipes`);
  return (data.recipes ?? []).map(toRecipe);
}

export async function deleteLikedRecipe(userId: string, recipeId: number) {
  await request<unknown>('DELETE', `/api/users/${userPath(userId)}/liked-recipes/${recipeId}`);
}

/** 404 from an endpoint that does exist means the account is gone; a missing route says "Not Found". */
export function isUserMissing(error: unknown) {
  return error instanceof ApiError && error.status === 404 && /user not found/i.test(error.message);
}

export async function sendSwipe(userId: string, recipeId: number, action: 'like' | 'dislike') {
  return request<SwipeResult>('POST', '/api/swipe', { user_id: userId, recipe_id: recipeId, action });
}

// ---------- fridge (API v8) ----------

export type IngredientGroup = { id: number; name: string };

/** ~1000 canonical ingredients the fridge search works on. Fetched once per page load. */
let groupsPromise: Promise<IngredientGroup[]> | null = null;
export function getIngredientGroups(): Promise<IngredientGroup[]> {
  groupsPromise ??= request<{ groups: { group_id: number; canonical_name: string }[] | null }>(
    'GET',
    '/api/ingredients/groups',
  ).then(
    (data) =>
      (data.groups ?? [])
        .filter((group) => typeof group.group_id === 'number' && group.canonical_name)
        .map((group) => ({ id: group.group_id, name: decodeEntities(group.canonical_name).trim() })),
    (error: unknown) => {
      groupsPromise = null; // let the next call retry
      throw error;
    },
  );
  return groupsPromise;
}

export type MissingIngredient = { name: string; groupId?: number };

export type FridgeMatch = {
  recipe: Recipe;
  /** Ingredients the user doesn't have — null when the backend doesn't say. */
  missing: MissingIngredient[] | null;
  missingCount: number | null;
  /** Required (non-optional) ingredients of the recipe — `total_required` in API v8. */
  total: number | null;
};

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

/** Missing ingredients as names (c("a","b") / ["a"]) or as groups ([{group_id, canonical_name}]). */
function parseMissing(value: unknown): MissingIngredient[] | null {
  if (value === undefined || value === null || typeof value === 'number') return null;
  if (Array.isArray(value) && value.some(isRow)) {
    return value.flatMap((item) => {
      if (!isRow(item)) return typeof item === 'string' && item.trim() ? [{ name: item.trim() }] : [];
      const name = item.canonical_name ?? item.name ?? item.ingredient ?? item.ingredient_name;
      if (typeof name !== 'string' || !name.trim()) return [];
      const id = item.group_id ?? item.id;
      return [{ name: decodeEntities(name).trim(), groupId: typeof id === 'number' ? id : undefined }];
    });
  }
  if (typeof value !== 'string' && !Array.isArray(value)) return null;
  return parseList(value as ApiList).map((name) => ({ name }));
}

const firstNumber = (...values: unknown[]) => values.find((value): value is number => typeof value === 'number') ?? null;

/** One row of the fridge answer: a recipe with match info, either flat or as { recipe: {...}, missing... }. */
function toFridgeMatch(row: unknown): FridgeMatch | null {
  if (!isRow(row)) return null;
  const raw = isRow(row.recipe) ? { ...row.recipe, ...row } : row;
  if (typeof raw.recipe_id !== 'number') return null;
  const missing = parseMissing(
    raw.missing_ingredients ?? raw.missing_groups ?? raw.missing_ingredient_names ?? raw.missing,
  );
  const missingCount = firstNumber(raw.missing_count, raw.missing_ingredients_count, raw.missing) ?? missing?.length ?? null;
  const total = firstNumber(raw.total_required, raw.total_count);
  return { recipe: toRecipe(raw as unknown as ApiRecipe), missing, missingCount, total };
}

/** Recipes that can be made from the selected groups, allowing up to `maxMissing` extra ingredients. */
export async function getFridgeRecipes(
  userId: string,
  groupIds: number[],
  maxMissing: number,
  limit = 20,
): Promise<FridgeMatch[]> {
  const data = await request<unknown>(
    'POST',
    `/api/recipes/fridge/${userPath(userId)}`,
    { group_ids: groupIds, max_missing: maxMissing, limit },
    FEED_TIMEOUT_MS,
  );
  const rows = Array.isArray(data) ? data : isRow(data) ? (data.recipes ?? data.results ?? data.items) : null;
  if (!Array.isArray(rows)) {
    // Unknown shape — better an obvious error than a silent "nothing matches".
    console.error('ZjemTo API: unexpected fridge response', data);
    throw new ApiError(500, 'Nieoczekiwana odpowiedź serwera.');
  }
  const seen = new Set<number>();
  return rows.flatMap((row) => {
    const match = toFridgeMatch(row);
    if (!match || seen.has(match.recipe.apiId!)) return [];
    seen.add(match.recipe.apiId!);
    return [match];
  });
}

/** 422 from /recipes/fridge: {"detail": {"unknown_group_ids": [..]}} — e.g. saved ids after the database was rebuilt. */
export function unknownGroupIds(error: unknown): number[] {
  if (!(error instanceof ApiError) || error.status !== 422) return [];
  try {
    const detail = JSON.parse(error.message) as { unknown_group_ids?: unknown };
    return Array.isArray(detail.unknown_group_ids)
      ? detail.unknown_group_ids.filter((id): id is number => typeof id === 'number')
      : [];
  } catch {
    return [];
  }
}

// ---------- mapping backend recipe -> UI recipe ----------

export const API_PREFIX = 'api-';

export function apiIdOf(recipeId: string): number | null {
  if (!recipeId.startsWith(API_PREFIX)) return null;
  const value = Number(recipeId.slice(API_PREFIX.length));
  return Number.isFinite(value) ? value : null;
}

// English ingredient name (Food.com) -> id from the local fridge catalog (data.ts).
// Order matters: the first matching rule wins.
const INGREDIENT_RULES: [RegExp, string][] = [
  [/peanut butter|cream cheese|coconut milk|soy milk|almond milk/, ''],
  [/cottage cheese|ricotta|quark/, 'cottage'],
  [/parmesan/, 'parmesan'],
  [/feta/, 'feta'],
  [/\begg/, 'eggs'],
  [/bacon|pancetta/, 'bacon'],
  [/chicken/, 'chicken'],
  [/salmon/, 'salmon'],
  [/chickpea|garbanzo/, 'chickpeas'],
  [/butter/, 'butter'],
  [/cream/, 'cream'],
  [/milk/, 'milk'],
  [/tomato/, 'tomato'],
  [/cucumber/, 'cucumber'],
  [/garlic/, 'garlic'],
  [/onion|shallot|scallion/, 'onion'],
  [/bell pepper|red pepper|green pepper|yellow pepper|capsicum|paprika/, 'pepper'],
  [/spinach/, 'spinach'],
  [/mushroom/, 'mushrooms'],
  [/broccoli/, 'broccoli'],
  [/carrot/, 'carrot'],
  [/potato/, 'potato'],
  [/lemon/, 'lemon'],
  [/spaghetti|pasta|noodle|linguine|fettuccine|penne|macaroni/, 'spaghetti'],
  [/\brice\b/, 'rice'],
  [/buckwheat/, 'buckwheat'],
  [/flour/, 'flour'],
  [/soy sauce|tamari|\bsoy\b/, 'soy'],
  [/honey/, 'honey'],
];

// Basics everyone has — they never count as "missing".
const STAPLES = /^(salt|water|pepper|black pepper|sugar|granulated sugar|oil|olive oil|vegetable oil|canola oil|ice)$/;

/** Local fridge-catalog id for an English ingredient name (null for staples and unknown items). */
export function localIngredientId(name: string): string | null {
  const lower = name.toLowerCase();
  return STAPLES.test(lower) ? null : matchIngredient(lower);
}

function matchIngredient(name: string): string | null {
  for (const [pattern, id] of INGREDIENT_RULES) {
    if (pattern.test(name)) return id || null;
  }
  return null;
}

// Food.com keeps lists in R syntax: c("chicken", "garlic"). API.py only strips the quotes and splits on ", ",
// so the first item arrives as "c(chicken" and the last one as "garlic)".
function parseList(value: ApiList | undefined): string[] {
  if (!value) return [];
  let list: string[];
  if (Array.isArray(value)) {
    list = value;
  } else {
    const text = value.trim().replace(/^c\(/, '').replace(/\)$/, '');
    // Quoted items may contain commas ("Bake 30-35 minutes, then serve."), so read them as whole tokens.
    list = text.includes('"')
      ? Array.from(text.matchAll(/"((?:[^"]|"")*)"|([^,\s][^,]*)/g), (m) => (m[1] ?? m[2] ?? '').replace(/""/g, '"'))
      : text.split(',');
  }
  return list
    .map((item, index, all) => {
      let name = String(item).replace(/"/g, '').replace(/\s+/g, ' ').trim();
      if (index === 0) name = name.replace(/^c\(\s*/, '');
      if (index === all.length - 1) name = name.replace(/\s*\)$/, '');
      return decodeEntities(name.trim());
    })
    .filter((item) => item && item !== 'NA' && item !== 'character(0' && item !== 'character(0)');
}

// "Bake for 30-35 minutes", "simmer 1 hour", "cook 10 mins" -> a timer for the cooking view.
const TIME_IN_STEP = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/i;

function stepTimer(text: string): RecipeStep['timer'] {
  const match = TIME_IN_STEP.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]!.replace(',', '.'));
  const seconds = Math.round(value * (/^h/i.test(match[2]!) ? 3600 : 60));
  // Ignore "1 minute" stirs and day-long marinades.
  if (seconds < 120 || seconds > 6 * 3600) return undefined;
  const verb = /^[A-Za-z]+/.exec(text.trim())?.[0];
  return { label: verb ? verb[0]!.toUpperCase() + verb.slice(1).toLowerCase() : 'Minutnik', seconds };
}

const BOILERPLATE = /^make and share this .* recipe from food\.com\.?$/i;

function shorten(text: string, max = 140) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,.;:]+$/, '')}…`;
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** Food.com names sometimes contain HTML entities ("Mom&#39;s Pie &amp; Crust"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

// Food.com image URLs contain commas themselves (".../upload/w_555,h_416,c_fit,.../x.jpg"),
// so only split on a comma that starts the next URL. Accepts: plain URL, "URL", c("URL1", "URL2").
function parseImage(value: string | null): string {
  if (!value) return '';
  const text = value.trim();
  const quoted = /"(https?:\/\/[^"]+)"/.exec(text)?.[1];
  const bare = /https?:\/\/.+/.exec(text)?.[0].split(/,\s*(?=https?:\/\/)/)[0]?.replace(/["')\s]+$/, '');
  const url = (quoted ?? bare ?? '').trim();
  return url.replace(/ /g, '%20');
}

// Food.com stores times as ISO-8601 durations: "PT1H30M", "PT45M".
function parseMinutes(value: ApiRecipe['total_time']): number {
  if (typeof value === 'number') return Math.round(value);
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const hours = /(\d+)H/.exec(value)?.[1];
  const mins = /(\d+)M/.exec(value)?.[1];
  const days = /(\d+)D/.exec(value)?.[1];
  return Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(mins ?? 0);
}

const TINTS = [
  'linear-gradient(160deg, #3a2418 0%, #c56a32 100%)',
  'linear-gradient(160deg, #1f2a1c 0%, #6f8f3a 100%)',
  'linear-gradient(160deg, #2b1d2e 0%, #a2486b 100%)',
  'linear-gradient(160deg, #1c2633 0%, #3f7aa6 100%)',
  'linear-gradient(160deg, #33280f 0%, #c9a227 100%)',
];

export function toRecipe(raw: ApiRecipe): Recipe {
  const names = parseList(raw.ingredient_parts);
  const seen = new Set<string>();
  const ingredients: RecipeIngredient[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const staple = STAPLES.test(lower);
    const id = (!staple && matchIngredient(lower)) || `x:${lower}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ingredients.push({ id, amount: '', name, staple: staple || undefined });
  }

  const minutes = parseMinutes(raw.total_time);
  const listed = ingredients
    .filter((item) => !item.staple)
    .slice(0, 4)
    .map((item) => item.name)
    .join(', ');
  const description = decodeEntities(raw.description ?? '').replace(/\s+/g, ' ').trim();
  const usefulDescription = description && !BOILERPLATE.test(description) ? description : '';
  const instructions = parseList(raw.instructions);
  const steps: RecipeStep[] = instructions.length
    ? instructions.map((text) => ({ text, timer: stepTimer(text) }))
    : [{ text: `Przygotuj składniki: ${names.join(', ')}.` }];
  const nutrition =
    typeof raw.calories === 'number'
      ? { calories: raw.calories, protein: raw.protein ?? 0, fat: raw.fat ?? 0, carbs: raw.carbs ?? 0 }
      : undefined;

  return {
    id: `${API_PREFIX}${raw.recipe_id}`,
    apiId: raw.recipe_id,
    title: decodeEntities(raw.name ?? '').trim() || 'Przepis bez nazwy',
    tagline: usefulDescription ? shorten(usefulDescription) : listed,
    description: usefulDescription || undefined,
    nutrition,
    image: parseImage(raw.image_url),
    minutes,
    difficulty: ingredients.length > 9 || minutes > 60 ? 'średnio' : 'łatwo',
    servings: 0, // unknown — hidden in the UI
    cuisine: decodeEntities(raw.category ?? '').trim() || 'Food.com',
    meal: 'obiad',
    tint: TINTS[Math.abs(raw.recipe_id) % TINTS.length] ?? TINTS[0]!,
    ingredients,
    steps,
  };
}
