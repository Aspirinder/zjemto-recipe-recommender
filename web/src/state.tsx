import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Diet, Meal, Recipe, Screen, SwipeAction } from './types.ts';
import { allergens, diets, meals, recipes as localRecipes } from './data.ts';
import { ApiError, apiIdOf, fetchPersonalized, initUser, sendSwipe } from './api.ts';

export type ApiStatus = 'loading' | 'ready' | 'error';

/** Ask the backend for more cards when fewer than this many unseen cards are left. */
const PREFETCH_AT = 5;
/** Stop asking after this many responses in a row that brought nothing new. */
const MAX_STALE = 3;

const localById = new Map(localRecipes.map((recipe) => [recipe.id, recipe]));

const STORAGE_KEY = 'nyam-v1';

type Store = {
  fridge: string[];
  liked: string[];
  passed: string[];
  history: SwipeAction[];
  strict: boolean;
  hintSeen: boolean;
  loved: string[];
  avoided: string[];
  profileName: string;
  signedIn: boolean;
  onboarded: boolean;
  diet: Diet;
  allergies: string[];
  mealFilter: Meal[];
  toastDismissed: boolean;
  /** user_id issued by POST /api/users/init. */
  userId: string | null;
  /** Liked recipes that came from the API — kept so "Polubione" survives a reload. */
  saved: Record<string, Recipe>;
};

const emptyStore: Store = {
  fridge: [],
  liked: [],
  passed: [],
  history: [],
  strict: false,
  hintSeen: false,
  loved: [],
  avoided: [],
  profileName: '',
  signedIn: false,
  onboarded: false,
  diet: 'wszystko',
  allergies: [],
  mealFilter: [],
  toastDismissed: false,
  userId: null,
  saved: {},
};

function asStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asHistory(value: unknown): SwipeAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { id?: unknown; kind?: unknown };
    if (typeof row.id !== 'string') return [];
    if (row.kind !== 'like' && row.kind !== 'pass') return [];
    return [{ id: row.id, kind: row.kind }];
  });
}

function asSaved(value: unknown): Record<string, Recipe> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, Recipe> = {};
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue;
    const recipe = item as Partial<Recipe>;
    if (recipe.id !== id || typeof recipe.title !== 'string') continue;
    if (!Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps)) continue;
    out[id] = recipe as Recipe;
  }
  return out;
}

function pruneSaved(saved: Record<string, Recipe>, liked: readonly string[]) {
  const keep = new Set(liked);
  return Object.fromEntries(Object.entries(saved).filter(([id]) => keep.has(id)));
}

function asDiet(value: unknown): Diet {
  return diets.some((item) => item.id === value) ? (value as Diet) : 'wszystko';
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyStore;
    const data = parsed as Partial<Store>;
    return {
      fridge: asStrings(data.fridge),
      liked: asStrings(data.liked),
      passed: asStrings(data.passed),
      history: asHistory(data.history),
      strict: Boolean(data.strict),
      hintSeen: Boolean(data.hintSeen),
      loved: asStrings(data.loved),
      avoided: asStrings(data.avoided),
      profileName: typeof data.profileName === 'string' ? data.profileName.slice(0, 32) : '',
      signedIn: Boolean(data.signedIn),
      onboarded: Boolean(data.onboarded),
      diet: asDiet(data.diet),
      allergies: asStrings(data.allergies).filter((id) => allergens.some((item) => item.id === id)),
      mealFilter: asStrings(data.mealFilter).filter((id): id is Meal => meals.some((item) => item.id === id)),
      toastDismissed: Boolean(data.toastDismissed),
      userId: typeof data.userId === 'string' && data.userId ? data.userId : null,
      saved: asSaved(data.saved),
    };
  } catch {
    return emptyStore;
  }
}

type AppContextValue = {
  fridge: string[];
  liked: string[];
  passed: string[];
  strict: boolean;
  hintSeen: boolean;
  loved: string[];
  avoided: string[];
  profileName: string;
  signedIn: boolean;
  onboarded: boolean;
  diet: Diet;
  allergies: string[];
  mealFilter: Meal[];
  toastDismissed: boolean;
  userId: string | null;
  /** Recipes the deck draws from: the API feed, or the built-in ones when the server is unreachable. */
  pool: Recipe[];
  apiStatus: ApiStatus;
  usingLocal: boolean;
  retryApi: () => void;
  getRecipe: (id: string) => Recipe | undefined;
  swipes: number;
  canUndo: boolean;
  screen: Screen;
  cookingId: string | null;
  setScreen: (screen: Screen) => void;
  openCook: (id: string) => void;
  closeCook: () => void;
  toggleFridge: (id: string) => void;
  setFridge: (ids: string[]) => void;
  clearFridge: () => void;
  toggleStrict: () => void;
  like: (id: string) => void;
  pass: (id: string) => void;
  unlike: (id: string) => void;
  undo: () => void;
  restorePassed: () => void;
  setTaste: (id: string, taste: 'love' | 'avoid' | 'off') => void;
  clearTaste: () => void;
  setProfileName: (name: string) => void;
  setDiet: (diet: Diet) => void;
  toggleAllergy: (id: string) => void;
  toggleMeal: (meal: Meal) => void;
  signIn: () => void;
  signOut: () => void;
  finishOnboarding: () => void;
  dismissToast: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(loadStore);
  const [screen, setScreen] = useState<Screen>('deck');
  const [cookingId, setCookingId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  // ---------- backend ----------
  const [feed, setFeed] = useState<Recipe[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus>('loading');
  const feedRef = useRef(feed);
  const storeRef = useRef(store);
  const userRef = useRef<Promise<string> | null>(store.userId ? Promise.resolve(store.userId) : null);
  const swipeChain = useRef<Promise<unknown>>(Promise.resolve());
  const loadingRef = useRef(false);
  const staleRef = useRef(0);
  useEffect(() => {
    feedRef.current = feed;
    storeRef.current = store;
  }, [feed, store]);

  const ensureUser = useCallback((fresh = false) => {
    if (fresh || !userRef.current) {
      const pending = initUser().then((id) => {
        setStore((current) => ({ ...current, userId: id }));
        return id;
      });
      pending.catch(() => {
        if (userRef.current === pending) userRef.current = null;
      });
      userRef.current = pending;
    }
    return userRef.current;
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // Let the backend record pending swipes first, so the profile is up to date.
      await swipeChain.current;
      let userId = await ensureUser();
      let batch: Recipe[];
      try {
        batch = await fetchPersonalized(userId);
      } catch (error) {
        // The user was removed from the database — register a new one.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        userId = await ensureUser(true);
        batch = await fetchPersonalized(userId);
      }
      const { liked, passed } = storeRef.current;
      const known = new Set([...feedRef.current.map((recipe) => recipe.id), ...liked, ...passed]);
      const fresh = batch.filter((recipe) => !known.has(recipe.id));
      staleRef.current = fresh.length === 0 ? staleRef.current + 1 : 0;
      if (fresh.length > 0) setFeed((current) => [...current, ...fresh]);
      setApiStatus('ready');
    } catch (error) {
      console.error('ZjemTo API:', error);
      setApiStatus('error');
    } finally {
      loadingRef.current = false;
    }
  }, [ensureUser]);

  const retryApi = useCallback(() => {
    staleRef.current = 0;
    setApiStatus('loading');
    void loadMore();
  }, [loadMore]);

  const unseen = useMemo(() => {
    const hidden = new Set([...store.liked, ...store.passed]);
    return feed.filter((recipe) => !hidden.has(recipe.id)).length;
  }, [feed, store.liked, store.passed]);

  useEffect(() => {
    if (apiStatus === 'error') return;
    if (unseen >= PREFETCH_AT || staleRef.current >= MAX_STALE) return;
    void loadMore();
  }, [unseen, apiStatus, loadMore]);

  const syncSwipe = useCallback(
    (id: string, action: 'like' | 'dislike') => {
      const recipeId = apiIdOf(id);
      if (recipeId === null) return;
      swipeChain.current = swipeChain.current
        .then(async () => sendSwipe(await ensureUser(), recipeId, action))
        .catch((error: unknown) => console.warn('ZjemTo API: swipe not saved', error));
    },
    [ensureUser],
  );

  const usingLocal = apiStatus === 'error' && feed.length === 0;
  const pool = usingLocal ? localRecipes : feed;

  const getRecipe = useCallback(
    (id: string) => localById.get(id) ?? feed.find((recipe) => recipe.id === id) ?? store.saved[id],
    [feed, store.saved],
  );

  const like = useCallback((id: string) => {
    const recipe = feedRef.current.find((item) => item.id === id);
    setStore((current) => ({
      ...current,
      saved: recipe ? { ...current.saved, [id]: recipe } : current.saved,
      liked: current.liked.includes(id) ? current.liked : [id, ...current.liked],
      passed: current.passed.filter((item) => item !== id),
      history: [{ id, kind: 'like' as const }, ...current.history].slice(0, 30),
      hintSeen: true,
    }));
    syncSwipe(id, 'like');
  }, [syncSwipe]);

  const pass = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      passed: current.passed.includes(id) ? current.passed : [id, ...current.passed],
      liked: current.liked.filter((item) => item !== id),
      history: [{ id, kind: 'pass' as const }, ...current.history].slice(0, 30),
      hintSeen: true,
    }));
    syncSwipe(id, 'dislike');
  }, [syncSwipe]);

  // Note: the backend has no "undo swipe" endpoint — unlike/undo change only the local state.
  const unlike = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      liked: current.liked.filter((item) => item !== id),
      saved: pruneSaved(current.saved, current.liked.filter((item) => item !== id)),
      history: current.history.filter((item) => !(item.id === id && item.kind === 'like')),
    }));
  }, []);

  const undo = useCallback(() => {
    setStore((current) => {
      const [last, ...rest] = current.history;
      if (!last) return current;
      if (last.kind === 'like') {
        const liked = current.liked.filter((id) => id !== last.id);
        return { ...current, history: rest, liked, saved: pruneSaved(current.saved, liked) };
      }
      return { ...current, history: rest, passed: current.passed.filter((id) => id !== last.id) };
    });
  }, []);

  const toggleFridge = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      fridge: current.fridge.includes(id)
        ? current.fridge.filter((item) => item !== id)
        : [...current.fridge, id],
    }));
  }, []);

  const setFridge = useCallback((ids: string[]) => {
    setStore((current) => ({ ...current, fridge: ids }));
  }, []);

  const clearFridge = useCallback(() => {
    setStore((current) => ({ ...current, fridge: [] }));
  }, []);

  const toggleStrict = useCallback(() => {
    setStore((current) => ({ ...current, strict: !current.strict }));
  }, []);

  const restorePassed = useCallback(() => {
    setStore((current) => ({
      ...current,
      passed: [],
      history: current.history.filter((item) => item.kind !== 'pass'),
    }));
  }, []);

  const setTaste = useCallback((id: string, taste: 'love' | 'avoid' | 'off') => {
    setStore((current) => ({
      ...current,
      loved: taste === 'love' ? [...current.loved.filter((item) => item !== id), id] : current.loved.filter((item) => item !== id),
      avoided:
        taste === 'avoid'
          ? [...current.avoided.filter((item) => item !== id), id]
          : current.avoided.filter((item) => item !== id),
    }));
  }, []);

  const clearTaste = useCallback(() => {
    setStore((current) => ({ ...current, loved: [], avoided: [], mealFilter: [] }));
  }, []);

  const setProfileName = useCallback((name: string) => {
    setStore((current) => ({ ...current, profileName: name.slice(0, 32) }));
  }, []);

  const setDiet = useCallback((diet: Diet) => {
    setStore((current) => ({ ...current, diet }));
  }, []);

  const toggleAllergy = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      allergies: current.allergies.includes(id)
        ? current.allergies.filter((item) => item !== id)
        : [...current.allergies, id],
    }));
  }, []);

  const toggleMeal = useCallback((meal: Meal) => {
    setStore((current) => ({
      ...current,
      mealFilter: current.mealFilter.includes(meal)
        ? current.mealFilter.filter((item) => item !== meal)
        : [...current.mealFilter, meal],
    }));
  }, []);

  const signIn = useCallback(() => {
    setStore((current) => ({ ...current, signedIn: true }));
    setScreen('deck');
  }, []);

  const signOut = useCallback(() => {
    setStore((current) => ({ ...current, signedIn: false }));
    setScreen('deck');
  }, []);

  const finishOnboarding = useCallback(() => {
    setStore((current) => ({ ...current, signedIn: true, onboarded: true, toastDismissed: false }));
    setScreen('deck');
  }, []);

  const dismissToast = useCallback(() => {
    setStore((current) => ({ ...current, toastDismissed: true }));
  }, []);

  const openCook = useCallback((id: string) => {
    setCookingId(id);
  }, []);

  const closeCook = useCallback(() => {
    setCookingId(null);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      fridge: store.fridge,
      liked: store.liked,
      passed: store.passed,
      strict: store.strict,
      hintSeen: store.hintSeen,
      loved: store.loved,
      avoided: store.avoided,
      profileName: store.profileName,
      signedIn: store.signedIn,
      onboarded: store.onboarded,
      diet: store.diet,
      allergies: store.allergies,
      mealFilter: store.mealFilter,
      toastDismissed: store.toastDismissed,
      userId: store.userId,
      pool,
      apiStatus,
      usingLocal,
      retryApi,
      getRecipe,
      swipes: store.liked.length + store.passed.length,
      canUndo: store.history.length > 0,
      screen,
      cookingId,
      setScreen,
      openCook,
      closeCook,
      toggleFridge,
      setFridge,
      clearFridge,
      toggleStrict,
      like,
      pass,
      unlike,
      undo,
      restorePassed,
      setTaste,
      clearTaste,
      setProfileName,
      setDiet,
      toggleAllergy,
      toggleMeal,
      signIn,
      signOut,
      finishOnboarding,
      dismissToast,
    }),
    [
      store,
      pool,
      apiStatus,
      usingLocal,
      retryApi,
      getRecipe,
      screen,
      cookingId,
      openCook,
      closeCook,
      toggleFridge,
      setFridge,
      clearFridge,
      toggleStrict,
      like,
      pass,
      unlike,
      undo,
      restorePassed,
      setTaste,
      clearTaste,
      setProfileName,
      setDiet,
      toggleAllergy,
      toggleMeal,
      signIn,
      signOut,
      finishOnboarding,
      dismissToast,
    ],
  );

  return <AppContext value={value}>{children}</AppContext>;
}

// Hook lives next to the provider so the context stays private.
// oxlint-disable-next-line react/only-export-components
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp musi być wewnątrz AppStateProvider');
  return context;
}
