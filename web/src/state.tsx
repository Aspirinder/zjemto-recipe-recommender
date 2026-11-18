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
import { diets, meals, recipes as localRecipes } from './data.ts';
import {
  ApiError,
  apiIdOf,
  deleteLikedRecipe,
  getAllergies,
  getFeed,
  getLikedRecipes,
  isUserMissing,
  putAllergies,
  sendSwipe,
  signIn,
  signUp,
} from './api.ts';

export type ApiStatus = 'idle' | 'loading' | 'ready' | 'error';
export type FeedMode = 'calibration' | 'personalized';
export type AuthKind = 'signin' | 'signup';

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
  diet: Diet;
  /** Backend allergen tags (users.allergies). */
  allergies: string[];
  mealFilter: Meal[];
  /** user_id from /api/users/signin or /signup; null = signed out. */
  userId: string | null;
  email: string;
  /** Account the liked/passed lists belong to — they are cleared when someone else signs in. */
  ownerId: string | null;
  /** Browsing the built-in sample recipes without an account. */
  demo: boolean;
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
  diet: 'wszystko',
  allergies: [],
  mealFilter: [],
  userId: null,
  email: '',
  ownerId: null,
  demo: false,
  saved: {},
};

function asStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function asId(value: unknown) {
  return typeof value === 'string' && value ? value : null;
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
    const userId = asId(data.userId);
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
      diet: asDiet(data.diet),
      allergies: asStrings(data.allergies),
      mealFilter: asStrings(data.mealFilter).filter((id): id is Meal => meals.some((item) => item.id === id)),
      userId,
      email: typeof data.email === 'string' ? data.email : '',
      // Stores from before sign-in existed: the lists belong to whoever was using the app.
      ownerId: asId(data.ownerId) ?? userId,
      demo: Boolean(data.demo),
      saved: asSaved(data.saved),
    };
  } catch {
    return emptyStore;
  }
}

function describeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'Brak połączenia z serwerem.';
    if (error.status === 503) return 'Serwis rekomendacji chwilowo nie działa.';
    if (error.status === 409) return 'Serwer nie ma jeszcze profilu Twojego gustu.';
    if (error.status >= 500) return 'Serwer ma problem. Spróbuj za chwilę.';
    return error.message;
  }
  return 'Coś poszło nie tak.';
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
  diet: Diet;
  allergies: string[];
  mealFilter: Meal[];
  userId: string | null;
  email: string;
  demo: boolean;
  /** Message for the sign-in screen, e.g. after the account disappeared. */
  authNotice: string;
  /** Recipes the deck draws from: the API feed, or the built-in ones (demo / server unreachable). */
  pool: Recipe[];
  apiStatus: ApiStatus;
  feedMode: FeedMode | null;
  calibration: { current: number; required: number } | null;
  /** The server keeps returning nothing new (e.g. the ML service gave no recommendations). */
  exhausted: boolean;
  usingLocal: boolean;
  allergyError: string;
  /** Why the last feed request failed (shown with apiStatus === 'error'). */
  apiErrorText: string;
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
  /** Throws ApiError (401 wrong password, 409 email taken, 422 invalid email, 0 no connection). */
  authenticate: (kind: AuthKind, email: string, password: string) => Promise<void>;
  signOut: () => void;
  enterDemo: () => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(loadStore);
  const [screen, setScreen] = useState<Screen>('deck');
  const [cookingId, setCookingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // storage full or blocked — the app still works for this session
    }
  }, [store]);

  // ---------- backend ----------
  const [feed, setFeed] = useState<Recipe[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus>(store.userId ? 'loading' : 'idle');
  const [feedMode, setFeedMode] = useState<FeedMode | null>(null);
  const [calibration, setCalibration] = useState<{ current: number; required: number } | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [allergyError, setAllergyError] = useState('');
  const [apiErrorText, setApiErrorText] = useState('');

  const feedRef = useRef(feed);
  const storeRef = useRef(store);
  const modeRef = useRef(feedMode);
  const swipeChain = useRef<Promise<unknown>>(Promise.resolve());
  const loadingRef = useRef(false);
  const staleRef = useRef(0);
  /** Bumped whenever the feed is thrown away; answers to older requests are then ignored. */
  const genRef = useRef(0);
  const allergyChain = useRef<Promise<unknown>>(Promise.resolve());
  const allergySeq = useRef(0);
  /** Last allergy list the server confirmed — what we fall back to when saving fails. */
  const confirmedAllergies = useRef(store.allergies);
  useEffect(() => {
    feedRef.current = feed;
    storeRef.current = store;
    modeRef.current = feedMode;
  }, [feed, store, feedMode]);

  const resetFeed = useCallback((keepSwiped: boolean) => {
    genRef.current += 1;
    loadingRef.current = false;
    staleRef.current = 0;
    setExhausted(false);
    if (keepSwiped) {
      const { liked, passed } = storeRef.current;
      const swiped = new Set([...liked, ...passed]);
      const kept = feedRef.current.filter((recipe) => swiped.has(recipe.id));
      feedRef.current = kept;
      setFeed(kept);
    } else {
      feedRef.current = [];
      setFeed([]);
      setFeedMode(null);
      setCalibration(null);
    }
  }, []);

  const signOut = useCallback(
    (notice = '') => {
      resetFeed(false);
      setApiStatus('idle');
      setAuthNotice(notice);
      setAllergyError('');
      setCookingId(null);
      setScreen('deck');
      setStore((current) => ({ ...current, userId: null, demo: false }));
    },
    [resetFeed],
  );

  const handleLostUser = useCallback(
    (error: unknown) => {
      if (isUserMissing(error)) {
        signOut('Nie znaleziono konta. Zaloguj się ponownie.');
        return true;
      }
      return false;
    },
    [signOut],
  );

  const loadMore = useCallback(async () => {
    const userId = storeRef.current.userId;
    if (!userId || loadingRef.current) return;
    loadingRef.current = true;
    const gen = genRef.current;
    try {
      // Let the backend record pending swipes first, so the profile is up to date.
      await swipeChain.current;
      // The feed may have been reset while we waited (calibration finished, sign-out, allergies) —
      // then a newer request is already on its way; don't hit the slow ML endpoint twice.
      if (gen !== genRef.current) return;
      const data = await getFeed(userId);
      if (gen !== genRef.current) return;
      setFeedMode(data.mode);
      modeRef.current = data.mode;
      setCalibration(data.progress);
      const { liked, passed } = storeRef.current;
      const known = new Set([...feedRef.current.map((recipe) => recipe.id), ...liked, ...passed]);
      const fresh = data.recipes.filter((recipe) => !known.has(recipe.id));
      staleRef.current = fresh.length === 0 ? staleRef.current + 1 : 0;
      setExhausted(staleRef.current >= MAX_STALE);
      if (fresh.length > 0) {
        feedRef.current = [...feedRef.current, ...fresh];
        setFeed(feedRef.current);
      }
      setApiStatus('ready');
    } catch (error) {
      if (gen !== genRef.current) return;
      if (handleLostUser(error)) return;
      console.error('ZjemTo API:', error);
      setApiErrorText(describeError(error));
      setApiStatus('error');
    } finally {
      if (gen === genRef.current) loadingRef.current = false;
    }
  }, [handleLostUser]);

  /** API v7 keeps likes on the server: take its list as the truth for server recipes. */
  const syncLikes = useCallback(async () => {
    const userId = storeRef.current.userId;
    if (!userId) return;
    try {
      // Swipes still on their way would be missing from the server's answer.
      await swipeChain.current;
      const recipes = await getLikedRecipes(userId);
      if (storeRef.current.userId !== userId) return;
      setStore((current) => {
        const serverIds = recipes.map((recipe) => recipe.id);
        const local = current.liked.filter((id) => apiIdOf(id) === null);
        const liked = [...serverIds, ...local];
        const saved = { ...pruneSaved(current.saved, local), ...Object.fromEntries(recipes.map((r) => [r.id, r])) };
        const likedSet = new Set(serverIds);
        return {
          ...current,
          liked,
          saved,
          passed: current.passed.filter((id) => !likedSet.has(id)),
          history: current.history.filter((item) => item.kind !== 'like' || apiIdOf(item.id) === null || likedSet.has(item.id)),
        };
      });
    } catch (error) {
      if (handleLostUser(error)) return;
      // Older API without /liked-recipes, or offline — keep the local list.
      console.warn('ZjemTo API: liked recipes not loaded', error);
    }
  }, [handleLostUser]);

  const removeLikeOnServer = useCallback((id: string) => {
    const recipeId = apiIdOf(id);
    const userId = storeRef.current.userId;
    if (recipeId === null || !userId) return;
    // After the like itself has been recorded.
    swipeChain.current = swipeChain.current
      .then(() => deleteLikedRecipe(userId, recipeId))
      .catch((error: unknown) => console.warn('ZjemTo API: like not removed', error));
  }, []);

  useEffect(() => {
    if (store.userId) void syncLikes();
    // Once per account (sign-in or page load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.userId]);

  useEffect(() => {
    if (screen === 'likes') void syncLikes();
  }, [screen, syncLikes]);

  const retryApi = useCallback(() => {
    staleRef.current = 0;
    setExhausted(false);
    setApiStatus('loading');
    void loadMore();
  }, [loadMore]);

  const unseen = useMemo(() => {
    const hidden = new Set([...store.liked, ...store.passed]);
    return feed.filter((recipe) => !hidden.has(recipe.id)).length;
  }, [feed, store.liked, store.passed]);

  useEffect(() => {
    if (!store.userId || apiStatus === 'error' || exhausted) return;
    if (unseen >= PREFETCH_AT) return;
    void loadMore();
  }, [store.userId, unseen, apiStatus, exhausted, loadMore]);

  const syncSwipe = useCallback(
    (id: string, action: 'like' | 'dislike') => {
      const recipeId = apiIdOf(id);
      const userId = storeRef.current.userId;
      if (recipeId === null || !userId) return;
      const gen = genRef.current;
      swipeChain.current = swipeChain.current
        .then(async () => {
          const result = await sendSwipe(userId, recipeId, action);
          if (gen !== genRef.current) return;
          if (modeRef.current !== 'calibration') return;
          // "already_recorded" does not count towards calibration.
          if (result.status === 'success') {
            setCalibration((current) =>
              current ? { ...current, current: Math.min(current.required, current.current + 1) } : current,
            );
          }
          if (result.is_calibrated) {
            // Calibration finished: drop the random cards that are left and ask for recommendations.
            modeRef.current = 'personalized';
            setFeedMode('personalized');
            setCalibration(null);
            resetFeed(true);
            setApiStatus('loading');
            void loadMore();
          }
        })
        .catch((error: unknown) => {
          if (gen !== genRef.current) return;
          if (handleLostUser(error)) return;
          console.warn('ZjemTo API: swipe not saved', error);
        });
    },
    [handleLostUser, loadMore, resetFeed],
  );

  const usingLocal = !store.userId || (apiStatus === 'error' && feed.length === 0);
  // Signed out (demo): the account's server recipes stay stored for the next sign-in, but are not shown.
  const visibleLiked = useMemo(
    () => (store.userId ? store.liked : store.liked.filter((id) => apiIdOf(id) === null)),
    [store.userId, store.liked],
  );
  const visiblePassed = useMemo(
    () => (store.userId ? store.passed : store.passed.filter((id) => apiIdOf(id) === null)),
    [store.userId, store.passed],
  );
  const pool = usingLocal ? localRecipes : feed;

  const getRecipe = useCallback(
    (id: string) => localById.get(id) ?? feed.find((recipe) => recipe.id === id) ?? store.saved[id],
    [feed, store.saved],
  );

  const authenticate = useCallback(
    async (kind: AuthKind, rawEmail: string, password: string) => {
      const email = rawEmail.trim().toLowerCase();
      const userId = kind === 'signup' ? await signUp(email, password) : await signIn(email, password);
      let allergies = storeRef.current.allergies;
      try {
        allergies = await getAllergies(userId);
      } catch (error) {
        // Not critical — keep the local selection; the next change is sent with PUT anyway.
        console.warn('ZjemTo API: could not load allergies', error);
      }
      confirmedAllergies.current = allergies;
      resetFeed(false);
      setAuthNotice('');
      setAllergyError('');
      setApiStatus('loading');
      setStore((current) => {
        const sameOwner = current.ownerId === userId;
        return {
          ...current,
          userId,
          email,
          ownerId: userId,
          demo: false,
          allergies,
          ...(sameOwner ? {} : { liked: [], passed: [], history: [], saved: {}, hintSeen: false }),
        };
      });
      setScreen('deck');
    },
    [resetFeed],
  );

  const enterDemo = useCallback(() => {
    setAuthNotice('');
    setStore((current) => ({ ...current, demo: true }));
    setScreen('deck');
  }, []);

  const toggleAllergy = useCallback(
    (id: string) => {
      const previous = storeRef.current.allergies;
      const next = previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id];
      // Update the ref right away so a second quick click builds on this one, not on the last render.
      storeRef.current = { ...storeRef.current, allergies: next };
      setAllergyError('');
      setStore((current) => ({ ...current, allergies: next }));
      const userId = storeRef.current.userId;
      if (!userId) return;
      // PUTs go one at a time and only the newest list is sent: otherwise a slow older request
      // can finish last and overwrite the newer list on the server.
      const seq = ++allergySeq.current;
      const isCurrent = () => seq === allergySeq.current && storeRef.current.userId === userId;
      allergyChain.current = allergyChain.current.then(async () => {
        if (!isCurrent()) return;
        try {
          const saved = await putAllergies(userId, next);
          if (storeRef.current.userId === userId) confirmedAllergies.current = saved;
          if (!isCurrent()) return;
          setStore((current) => ({ ...current, allergies: saved }));
          // Cards already in the queue were picked with the old allergies.
          resetFeed(true);
          setApiStatus('loading');
          void loadMore();
        } catch (error) {
          if (!isCurrent()) return;
          if (handleLostUser(error)) return;
          const confirmed = confirmedAllergies.current;
          storeRef.current = { ...storeRef.current, allergies: confirmed };
          setStore((current) => ({ ...current, allergies: confirmed }));
          setAllergyError(`Nie udało się zapisać alergii. ${describeError(error)}`);
        }
      });
    },
    [handleLostUser, loadMore, resetFeed],
  );

  const like = useCallback(
    (id: string) => {
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
    },
    [syncSwipe],
  );

  const pass = useCallback(
    (id: string) => {
      setStore((current) => ({
        ...current,
        passed: current.passed.includes(id) ? current.passed : [id, ...current.passed],
        liked: current.liked.filter((item) => item !== id),
        history: [{ id, kind: 'pass' as const }, ...current.history].slice(0, 30),
        hintSeen: true,
      }));
      syncSwipe(id, 'dislike');
    },
    [syncSwipe],
  );

  // The swipe itself stays on the server (no undo endpoint); only the favourite is removed.
  const unlike = useCallback(
    (id: string) => {
      setStore((current) => ({
        ...current,
        liked: current.liked.filter((item) => item !== id),
        saved: pruneSaved(current.saved, current.liked.filter((item) => item !== id)),
        history: current.history.filter((item) => !(item.id === id && item.kind === 'like')),
      }));
      removeLikeOnServer(id);
    },
    [removeLikeOnServer],
  );

  const undo = useCallback(() => {
    const last = storeRef.current.history[0];
    if (last?.kind === 'like' && storeRef.current.userId) removeLikeOnServer(last.id);
    setStore((current) => {
      const [last, ...rest] = current.history;
      if (!last) return current;
      // In demo, don't touch the signed-out account's swipes.
      if (!current.userId && apiIdOf(last.id) !== null) return current;
      if (last.kind === 'like') {
        const liked = current.liked.filter((id) => id !== last.id);
        return { ...current, history: rest, liked, saved: pruneSaved(current.saved, liked) };
      }
      return { ...current, history: rest, passed: current.passed.filter((id) => id !== last.id) };
    });
  }, [removeLikeOnServer]);

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

  const toggleMeal = useCallback((meal: Meal) => {
    setStore((current) => ({
      ...current,
      mealFilter: current.mealFilter.includes(meal)
        ? current.mealFilter.filter((item) => item !== meal)
        : [...current.mealFilter, meal],
    }));
  }, []);

  const openCook = useCallback((id: string) => {
    setCookingId(id);
  }, []);

  const closeCook = useCallback(() => {
    setCookingId(null);
  }, []);

  const signOutPlain = useCallback(() => signOut(), [signOut]);

  const value = useMemo<AppContextValue>(
    () => ({
      fridge: store.fridge,
      liked: visibleLiked,
      passed: visiblePassed,
      strict: store.strict,
      hintSeen: store.hintSeen,
      loved: store.loved,
      avoided: store.avoided,
      profileName: store.profileName,
      diet: store.diet,
      allergies: store.allergies,
      mealFilter: store.mealFilter,
      userId: store.userId,
      email: store.email,
      demo: store.demo,
      authNotice,
      pool,
      apiStatus,
      feedMode,
      calibration,
      exhausted,
      usingLocal,
      allergyError,
      apiErrorText,
      retryApi,
      getRecipe,
      swipes: visibleLiked.length + visiblePassed.length,
      canUndo: store.history.length > 0 && (Boolean(store.userId) || apiIdOf(store.history[0]!.id) === null),
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
      authenticate,
      signOut: signOutPlain,
      enterDemo,
    }),
    [
      store,
      visibleLiked,
      visiblePassed,
      authNotice,
      pool,
      apiStatus,
      feedMode,
      calibration,
      exhausted,
      usingLocal,
      allergyError,
      apiErrorText,
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
      authenticate,
      signOutPlain,
      enterDemo,
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
