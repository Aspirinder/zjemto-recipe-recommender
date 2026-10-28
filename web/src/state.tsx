import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Screen, SwipeAction } from './types.ts';

const STORAGE_KEY = 'zjemto-v1';

type Store = {
  fridge: string[];
  liked: string[];
  passed: string[];
  history: SwipeAction[];
  strict: boolean;
  hintSeen: boolean;
};

const emptyStore: Store = {
  fridge: [],
  liked: [],
  passed: [],
  history: [],
  strict: false,
  hintSeen: false,
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
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Store>(loadStore);
  const [screen, setScreen] = useState<Screen>('deck');
  const [cookingId, setCookingId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [store]);

  const like = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      liked: current.liked.includes(id) ? current.liked : [id, ...current.liked],
      passed: current.passed.filter((item) => item !== id),
      history: [{ id, kind: 'like' as const }, ...current.history].slice(0, 30),
      hintSeen: true,
    }));
  }, []);

  const pass = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      passed: current.passed.includes(id) ? current.passed : [id, ...current.passed],
      liked: current.liked.filter((item) => item !== id),
      history: [{ id, kind: 'pass' as const }, ...current.history].slice(0, 30),
      hintSeen: true,
    }));
  }, []);

  const unlike = useCallback((id: string) => {
    setStore((current) => ({
      ...current,
      liked: current.liked.filter((item) => item !== id),
      history: current.history.filter((item) => !(item.id === id && item.kind === 'like')),
    }));
  }, []);

  const undo = useCallback(() => {
    setStore((current) => {
      const [last, ...rest] = current.history;
      if (!last) return current;
      if (last.kind === 'like') {
        return { ...current, history: rest, liked: current.liked.filter((id) => id !== last.id) };
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
    }),
    [
      store,
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
    ],
  );

  return <AppContext value={value}>{children}</AppContext>;
}

// oxlint-disable-next-line react/only-export-components
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp musi być wewnątrz AppStateProvider');
  return context;
}
