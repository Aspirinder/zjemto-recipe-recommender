import type { Recipe, RecipeIngredient } from './types.ts';

// VITE_API_URL = origin of the ZjemTo FastAPI backend (see .env.example).
// Dev: requests go to relative `/api/...` and the Vite proxy forwards them, so the backend needs no CORS.
// Production build: requests go straight to VITE_API_URL (the backend must allow this origin via CORS).
const BASE = import.meta.env.DEV ? '' : ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

export type ApiRecipe = {
  recipe_id: number;
  name: string;
  image_url: string | null;
  ingredient_parts: string[] | string | null;
  total_time: string | number | null;
};

export type SwipeResult = {
  status: string;
  is_calibrated: boolean;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      // body was not JSON
    }
    throw new ApiError(response.status, detail);
  }
  return (await response.json()) as T;
}

export async function initUser(): Promise<string> {
  const data = await request<{ user_id: string | number }>('/api/users/init', { method: 'POST' });
  return String(data.user_id);
}

export async function fetchCalibration(userId: string): Promise<Recipe[]> {
  const data = await request<{ recipes: ApiRecipe[] }>(`/api/recipes/calibration/${encodeURIComponent(userId)}`);
  return data.recipes.map(toRecipe);
}

export async function fetchPersonalized(userId: string): Promise<Recipe[]> {
  const data = await request<{ recipes: ApiRecipe[] }>(`/api/recipe/personalized/${encodeURIComponent(userId)}`);
  return data.recipes.map(toRecipe);
}

export async function sendSwipe(userId: string, recipeId: number, action: 'like' | 'dislike') {
  return request<SwipeResult>('/api/swipe', {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, recipe_id: recipeId, action }),
  });
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

function parseList(value: ApiRecipe['ingredient_parts']): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : value.replace(/^c\(|\)$/g, '').split(',');
  return list.map((item) => item.replace(/"/g, '').trim()).filter((item) => item && item !== 'NA');
}

function parseImage(value: string | null): string {
  if (!value) return '';
  const match = /https?:\/\/[^"'\s,)]+/.exec(value);
  return match ? match[0] : '';
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
    title: raw.name,
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
