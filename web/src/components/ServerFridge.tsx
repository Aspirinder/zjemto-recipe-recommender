import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { getIngredientGroups, localIngredientId, type IngredientGroup, type MissingIngredient } from '../api.ts';
import { fridgeKey, ingredientById, plural, recipeKicker } from '../logic.ts';
import { useApp } from '../state.tsx';
import { Details } from './Details.tsx';
import { IconClose } from './icons.tsx';
import { Photo } from './Photo.tsx';

type Option = IngredientGroup & {
  /** Polish name and emoji from the local catalog, when the group maps onto it. */
  label?: string;
  emoji?: string;
  haystack: string;
};

const MAX_OPTIONS = 40;

/** "Ząbek" -> "zabek": lets people type without Polish letters. */
function normalize(text: string) {
  return text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function toOption(group: IngredientGroup): Option {
  const local = localIngredientId(group.name);
  const meta = local ? ingredientById(local) : undefined;
  return {
    ...group,
    label: meta?.name,
    emoji: meta?.emoji,
    haystack: normalize(`${group.name} ${meta?.name ?? ''}`),
  };
}

function rank(option: Option, query: string) {
  const name = normalize(option.name);
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(/[\s-]+/).some((word) => word.startsWith(query))) return 2;
  if (option.label && normalize(option.label).startsWith(query)) return 3;
  return 4;
}

const MISSING_LABEL: Record<number, string> = { 0: 'Nic', 1: 'Do 1', 2: 'Do 2' };

export function ServerFridge() {
  const app = useApp();
  const { pantry, maxMissing, fridgeSearch } = app;
  const [groups, setGroups] = useState<Option[] | null>(null);
  const [groupsError, setGroupsError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getIngredientGroups().then(
      (list) => {
        if (!alive) return;
        setGroupsError(false);
        setGroups(list.map(toOption));
      },
      (error: unknown) => {
        console.error('ZjemTo API: ingredient groups', error);
        if (alive) setGroupsError(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  // Saved ids the backend no longer has (database rebuilt) would make the whole request fail with 422.
  const { prunePantry } = app;
  useEffect(() => {
    if (groups) prunePantry(new Set(groups.map((group) => group.id)));
  }, [groups, prunePantry]);

  const selected = useMemo(() => new Set(pantry.map((group) => group.id)), [pantry]);
  const byId = useMemo(() => new Map((groups ?? []).map((group) => [group.id, group])), [groups]);
  const byName = useMemo(() => new Map((groups ?? []).map((group) => [group.name.toLowerCase(), group])), [groups]);

  const needle = normalize(query);
  const options = useMemo(() => {
    if (!groups || !needle) return [];
    return groups
      .filter((option) => option.haystack.includes(needle))
      .map((option) => ({ option, score: rank(option, needle) }))
      .sort((a, b) => a.score - b.score || a.option.name.length - b.option.name.length)
      .slice(0, MAX_OPTIONS)
      .map((item) => item.option);
  }, [groups, needle]);

  // With an empty search box: one shortcut per product of the local catalog ("Jajka" -> "egg").
  const quickPicks = useMemo(() => {
    const best = new Map<string, Option>();
    for (const option of groups ?? []) {
      if (!option.label) continue;
      const current = best.get(option.label);
      if (!current || option.name.length < current.name.length) best.set(option.label, option);
    }
    return [...best.values()];
  }, [groups]);

  const loading = fridgeSearch.status === 'loading';
  // The backend ranks fridge recipes by taste, so it answers 409 until calibration (20 swipes) is done.
  const calibrating = app.feedMode === 'calibration';
  const currentKey = fridgeKey(pantry, maxMissing);
  const outdated = fridgeSearch.key !== '' && fridgeSearch.key !== currentKey;
  const passed = new Set(app.passed);
  const liked = new Set(app.liked);
  const matches = fridgeSearch.matches.filter((match) => !passed.has(match.recipe.id));
  const open = openId ? fridgeSearch.matches.find((match) => match.recipe.id === openId)?.recipe : undefined;

  // Bring the loader into view once it has rendered (on a phone the button sits mid-page).
  useEffect(() => {
    if (loading) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading]);

  const search = () => app.searchFridge();

  const add = (option: IngredientGroup) => {
    if (!selected.has(option.id)) app.togglePantry({ id: option.id, name: option.name });
  };

  const chip = (option: Option) => {
    const pressed = selected.has(option.id);
    return (
      <button
        key={option.id}
        type="button"
        className="ing"
        aria-pressed={pressed}
        onClick={() => app.togglePantry({ id: option.id, name: option.name })}
      >
        {option.emoji && <span className="ing-emoji">{option.emoji}</span>}
        <span className={option.emoji ? undefined : 'ing-plain'}>
          {option.name}
          {option.label && <small> · {option.label.toLowerCase()}</small>}
        </span>
      </button>
    );
  };

  return (
    <section className="scroll-screen">
      <div className="page">
        <header className="page-intro">
          <p className="eyebrow">Lodówka</p>
          <h1>Co masz w domu</h1>
          <p>Wyszukaj i zaznacz produkty, a potem pokażemy przepisy, które z nich ugotujesz.</p>
        </header>

        <div className="pantry-search">
          <input
            type="search"
            value={query}
            placeholder={groups ? `Szukaj wśród ${groups.length} produktów, np. tomato, czosnek…` : 'Wczytuję produkty…'}
            aria-label="Szukaj produktu"
            disabled={!groups}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && options[0]) {
                add(options[0]);
                setQuery('');
              }
              if (event.key === 'Escape') setQuery('');
            }}
          />
          {query && (
            <button className="pantry-clear" type="button" aria-label="Wyczyść wyszukiwanie" onClick={() => setQuery('')}>
              <IconClose size={16} />
            </button>
          )}
        </div>

        {groupsError && !groups && (
          <p className="match-line">
            Nie udało się wczytać listy produktów.{' '}
            <button className="btn tiny quiet" type="button" onClick={() => setAttempt((value) => value + 1)}>
              Spróbuj ponownie
            </button>
          </p>
        )}
        {!groups && !groupsError && <p className="match-line muted">Wczytuję listę produktów…</p>}

        {groups && needle && (
          <div className="group-grid pantry-options pantry-scroll">
            {options.length > 0 ? options.map(chip) : <p className="match-line muted">Nic nie znaleziono dla „{query}”.</p>}
          </div>
        )}
        {groups && !needle && quickPicks.length > 0 && (
          <section className="group pantry-options">
            <h2>Szybki wybór</h2>
            <div className="pantry-quick">{quickPicks.map(chip)}</div>
          </section>
        )}

        <section className="panel pantry-panel">
          <div className="panel-head">
            <h2>
              W lodówce <span className="count">{pantry.length}</span>
            </h2>
            <button type="button" onClick={app.clearPantry} disabled={pantry.length === 0}>
              Wyczyść
            </button>
          </div>
          {pantry.length === 0 ? (
            <p>Pusto — dodaj co najmniej jeden produkt.</p>
          ) : (
            <div className="pantry-chips">
              {pantry.map((group) => (
                <button key={group.id} type="button" onClick={() => app.togglePantry(group)} aria-label={`Usuń ${group.name}`}>
                  {group.name}
                  <IconClose size={12} />
                </button>
              ))}
            </div>
          )}

          <div className="pantry-actions">
            <div className="segmented" role="radiogroup" aria-label="Ile składników może brakować">
              <span>Może brakować:</span>
              {[0, 1, 2].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={maxMissing === value}
                  onClick={() => app.setMaxMissing(value)}
                >
                  {MISSING_LABEL[value]}
                </button>
              ))}
            </div>
            <button className="btn flame" type="button" disabled={pantry.length === 0 || loading || calibrating} onClick={search}>
              {loading ? 'Szukam…' : outdated ? 'Odśwież przepisy' : 'Pokaż przepisy'}
            </button>
          </div>
        </section>

        <div ref={resultsRef} className="fridge-results-wrap">
          {loading && <FridgeLoader pantry={pantry} />}

          {!loading && (calibrating || fridgeSearch.needsCalibration) && (
            <div className="fridge-message">
              <p>
                Lodówka dobiera przepisy pod Twój gust — najpierw oceń przepisy w talii
                {app.calibration ? ` (${app.calibration.current} z ${app.calibration.required})` : ''}.
              </p>
              <button className="btn tiny" type="button" onClick={() => app.setScreen('deck')}>
                Do talii
              </button>
            </div>
          )}

          {!loading && fridgeSearch.status === 'error' && !fridgeSearch.needsCalibration && (
            <div className="fridge-message">
              <p>{fridgeSearch.error || 'Nie udało się pobrać przepisów.'}</p>
              <button className="btn tiny" type="button" onClick={search}>
                Spróbuj ponownie
              </button>
            </div>
          )}

          {/* After a failed refresh the old list would look like the answer — show only the error. */}
          {fridgeSearch.status === 'ready' && fridgeSearch.key !== '' && (
            <>
              {outdated && (
                <p className="match-line muted">Lodówka się zmieniła — odśwież, żeby zobaczyć nowe przepisy.</p>
              )}
              {matches.length === 0 ? (
                <div className="fridge-message">
                  <p>
                    Nic nie pasuje.{' '}
                    {maxMissing < 2 ? 'Pozwól, żeby brakowało więcej składników, albo dodaj produkty.' : 'Dodaj więcej produktów.'}
                  </p>
                </div>
              ) : (
                <>
                  <p className="match-line">
                    {matches.length} {plural(matches.length, 'przepis', 'przepisy', 'przepisów')} z Twojej lodówki
                  </p>
                  <ul className="fridge-results">
                    {matches.map(({ recipe, missing, missingCount, total }) => (
                      <li key={recipe.id}>
                        <button type="button" className="fridge-result" onClick={() => setOpenId(recipe.id)}>
                          <Photo src={recipe.image} tint={recipe.tint} />
                          <span className="fridge-result-copy">
                            <em>{recipeKicker(recipe, false)}</em>
                            <strong>{recipe.title}</strong>
                            {liked.has(recipe.id) && <span className="fridge-liked">♥ w polubionych</span>}
                          </span>
                        </button>
                        <MissingLine
                          missing={missing}
                          count={missingCount}
                          total={total}
                          find={(item) =>
                            (item.groupId !== undefined ? byId.get(item.groupId) : undefined) ?? byName.get(item.name.toLowerCase())
                          }
                          selected={selected}
                          onAdd={add}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {open && (
        <Details
          recipe={open}
          fridge={app.fridge}
          onClose={() => setOpenId(null)}
          onLike={() => {
            app.like(open.id);
            setOpenId(null);
          }}
          onPass={() => {
            app.pass(open.id);
            setOpenId(null);
          }}
        />
      )}
    </section>
  );
}

type MissingLineProps = {
  missing: MissingIngredient[] | null;
  count: number | null;
  total: number | null;
  find: (item: MissingIngredient) => IngredientGroup | undefined;
  selected: ReadonlySet<number>;
  onAdd: (group: IngredientGroup) => void;
};

function MissingLine({ missing, count, total, find, selected, onAdd }: MissingLineProps) {
  if (count === 0 || (missing && missing.length === 0)) return <p className="fridge-missing ok">Masz wszystko</p>;
  if (!missing) {
    if (count === null) return null;
    return (
      <p className="fridge-missing">
        {total
          ? `Brakuje ${count} z ${total} ${plural(total, 'składnika', 'składników', 'składników')}`
          : `Brakuje ${count} ${plural(count, 'składnika', 'składników', 'składników')}`}
      </p>
    );
  }
  return (
    <p className="fridge-missing">
      Brakuje:{' '}
      {missing.map((item, index) => {
        const { name } = item;
        const group = find(item);
        const comma = index < missing.length - 1 ? ', ' : '';
        if (!group || selected.has(group.id)) {
          return (
            <span key={index}>
              {name}
              {comma}
            </span>
          );
        }
        return (
          <span key={index}>
            <button type="button" onClick={() => onAdd({ id: group.id, name: group.name })} aria-label={`Dodaj ${name} do lodówki`}>
              + {name}
            </button>
            {comma}
          </span>
        );
      })}
    </p>
  );
}

const LOADING_STEPS = ['Zaglądam do lodówki…', 'Przeglądam przepisy…', 'Sprawdzam, czego brakuje…', 'Wybieram najlepsze…'];
const DEFAULT_EMOJI = ['🥕', '🧅', '🍅', '🧄', '🥚'];

/** The fridge search takes up to ~5 s (more if the server is waking up) — show that something is cooking. */
function FridgeLoader({ pantry }: { pantry: readonly IngredientGroup[] }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 400);
    return () => window.clearInterval(timer);
  }, []);

  const emoji = useMemo(() => {
    const own = pantry
      .map((group) => {
        const id = localIngredientId(group.name);
        return id ? ingredientById(id)?.emoji : undefined;
      })
      .filter((item): item is string => !!item);
    return [...new Set([...own, ...DEFAULT_EMOJI])].slice(0, 4);
  }, [pantry]);

  const message =
    elapsed > 9000
      ? 'Serwer się rozgrzewa — jeszcze chwila…'
      : LOADING_STEPS[Math.min(Math.floor(elapsed / 1600), LOADING_STEPS.length - 1)];

  return (
    <div className="fridge-loader">
      <div className="pot" aria-hidden="true">
        {emoji.map((item, index) => (
          <span key={item} className="pot-item" style={{ '--i': index } as CSSProperties}>
            {item}
          </span>
        ))}
        <span className="pot-steam" />
        <span className="pot-body" />
      </div>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <ul className="fridge-results skeleton" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <li key={index}>
            <span className="sk-photo" />
            <span className="sk-lines">
              <span />
              <span />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
