import type { Recipe, RecipeIngredient } from './types.ts';

// Address of the ZjemTo FastAPI backend (see .env.example). The backend allows any origin (CORS),
// so the browser talks to it directly. Without VITE_API_URL the deployed Azure API is used.
const DEFAULT_API = 'https://zjemto-api.azurewebsites.net';
const BASE = ((import.meta.env.VITE_API_URL as string | undefined) || DEFAULT_API).replace(/\/$/, '');

// A sleeping Azure instance needs ~15–30 s to start.
const TIMEOUT_MS = 60_000;
// The personalized feed additionally waits for the ML service (45 s timeout on the backend) — cold start + ML.
const FEED_TIMEOUT_MS = 90_000;

export type ApiRecipe = {
  recipe_id: number;
  name: string | null;
  image_url: string | null;
  ingredient_parts: string[] | string | null;
  total_time: string | number | null;
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
  method: 'GET' | 'POST' | 'PUT',
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
    return (await response.json()) as T;
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

export async function sendSwipe(userId: string, recipeId: number, action: 'like' | 'dislike') {
  return request<SwipeResult>('POST', '/api/swipe', { user_id: userId, recipe_id: recipeId, action });
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

function matchIngredient(name: string): string | null {
  for (const [pattern, id] of INGREDIENT_RULES) {
    if (pattern.test(name)) return id || null;
  }
  return null;
}

// Food.com keeps lists in R syntax: c("chicken", "garlic"). API.py only strips the quotes and splits on ", ",
// so the first item arrives as "c(chicken" and the last one as "garlic)".
function parseList(value: ApiRecipe['ingredient_parts']): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.split(',');
  return list
    .map((item, index, all) => {
      let name = item.replace(/"/g, '').trim();
      if (index === 0) name = name.replace(/^c\(\s*/, '');
      if (index === all.length - 1) name = name.replace(/\s*\)$/, '');
      return decodeEntities(name.trim());
    })
    .filter((item) => item && item !== 'NA' && item !== 'character(0' && item !== 'character(0)');
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

  return {
    id: `${API_PREFIX}${raw.recipe_id}`,
    apiId: raw.recipe_id,
    title: decodeEntities(raw.name ?? '').trim() || 'Przepis bez nazwy',
    tagline: listed,
    image: parseImage(raw.image_url),
    minutes,
    difficulty: ingredients.length > 9 || minutes > 60 ? 'średnio' : 'łatwo',
    servings: 0, // unknown — hidden in the UI
    cuisine: 'Food.com',
    meal: 'obiad',
    tint: TINTS[Math.abs(raw.recipe_id) % TINTS.length] ?? TINTS[0]!,
    ingredients,
    // The API does not return instructions yet — one summary step keeps the cooking view usable.
    steps: [
      {
        text: `Przygotuj składniki: ${names.join(', ')}. Szczegółowe kroki pojawią się, gdy API zacznie zwracać instrukcje.`,
      },
    ],
  };
}
