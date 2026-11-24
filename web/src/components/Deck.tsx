import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type TransitionEvent as ReactTransitionEvent } from 'react';
import type { Recipe } from '../types.ts';
import { countMatches, ingredientById, ingredientName, pantryProducts, plural, recipeKicker, splitIngredients, unlockSuggestions, visibleDeck } from '../logic.ts';
import { ingredientPl } from '../ingredientsPl.ts';
import { useApp } from '../state.tsx';
import { Details } from './Details.tsx';
import { IconHeart, IconInfo, IconNope, IconUndo } from './icons.tsx';
import { Photo } from './Photo.tsx';

const THRESHOLD = 120;
const EXIT_MS = 420;

export function Deck() {
  const app = useApp();
  // Recipes from the API are already filtered by allergies on the backend; sample recipes are filtered here.
  const localAllergies = app.usingLocal ? app.allergies : [];
  const queue = visibleDeck(
    app.pool,
    app.fridge,
    app.liked,
    app.passed,
    app.strict,
    [],
    [],
    [],
    'wszystko',
    localAllergies,
  );
  const top = queue[0];
  const back = queue.slice(1, 3);
  const [details, setDetails] = useState(false);
  const [announce, setAnnounce] = useState('');
  const stackRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLElement>(null);
  const drag = useRef({ active: false, pid: -1, sx: 0, sy: 0, x: 0 });
  const exitRef = useRef<'left' | 'right' | null>(null);
  const detailsRef = useRef(false);
  const cookingRef = useRef(false);
  const undoRef = useRef(app.undo);
  const swipeRef = useRef<(dir: 'left' | 'right') => void>(() => {});
  const commitRef = useRef<() => void>(() => {});
  const exitTimer = useRef<number | undefined>(undefined);

  const paint = (x: number, y: number, animate: boolean) => {
    const stack = stackRef.current;
    const card = topRef.current;
    if (stack) {
      stack.style.setProperty('--p', String(Math.min(Math.abs(x) / THRESHOLD, 1)));
      stack.classList.toggle('dragging', !animate);
    }
    if (!card) return;
    const rot = Math.max(-14, Math.min(14, x / 20));
    card.style.transition = animate ? `transform ${EXIT_MS}ms cubic-bezier(.16, .84, .3, 1)` : 'none';
    card.style.transform = `translate3d(${x}px, ${y * 0.35}px, 0) rotate(${rot}deg)`;
    card.style.setProperty('--x', String(x));
  };

  const topId = top?.id;

  useEffect(() => {
    window.clearTimeout(exitTimer.current);
    exitRef.current = null;
    drag.current.active = false;
    const stack = stackRef.current;
    if (stack) {
      stack.classList.add('instant');
      stack.classList.remove('dragging');
      stack.style.setProperty('--p', '0');
      requestAnimationFrame(() => stack.classList.remove('instant'));
    }
    const card = topRef.current;
    if (!card) return;
    card.style.transition = 'none';
    card.style.transform = 'translate3d(0, 0, 0)';
    card.style.setProperty('--x', '0');
  }, [topId]);

  useEffect(() => {
    detailsRef.current = details;
    cookingRef.current = app.cookingId !== null;
    undoRef.current = app.undo;
    swipeRef.current = (dir) => {
      if (!top || exitRef.current || detailsRef.current || cookingRef.current) return;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        setAnnounce(dir === 'right' ? `${top.title} w polubionych` : `${top.title} pominięty`);
        if (dir === 'right') app.like(top.id);
        else app.pass(top.id);
        return;
      }
      exitRef.current = dir;
      const fly = Math.max(window.innerWidth, 560);
      paint(dir === 'right' ? fly : -fly, 36, true);
      // transitionend is not guaranteed (hidden tab, card inserted in the same frame, layout shift),
      // so commit the swipe on a timer as well — otherwise the card can freeze mid-flight.
      window.clearTimeout(exitTimer.current);
      exitTimer.current = window.setTimeout(() => commitRef.current(), EXIT_MS + 80);
    };
    commitRef.current = () => {
      window.clearTimeout(exitTimer.current);
      const dir = exitRef.current;
      if (!dir || !top) return;
      exitRef.current = null;
      setAnnounce(dir === 'right' ? `${top.title} w polubionych` : `${top.title} pominięty`);
      if (dir === 'right') app.like(top.id);
      else app.pass(top.id);
    };
  });

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (event.key === 'Escape') {
        setDetails(false);
        return;
      }
      if (detailsRef.current || cookingRef.current) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        swipeRef.current('right');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        swipeRef.current('left');
      } else if (event.key.toLowerCase() === 'u' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        undoRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!details) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [details]);

  const nextImage = queue[1]?.image;
  useEffect(() => {
    if (!nextImage) return;
    const image = new Image();
    image.src = nextImage;
  }, [nextImage]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (exitRef.current) return;
    if ((event.target as HTMLElement).closest('button')) return;
    drag.current = { active: true, pid: event.pointerId, sx: event.clientX, sy: event.clientY, x: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current.active || event.pointerId !== current.pid) return;
    const x = event.clientX - current.sx;
    const y = event.clientY - current.sy;
    current.x = x;
    paint(x, y, false);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current.active || event.pointerId !== current.pid) return;
    current.active = false;
    if (current.x > THRESHOLD) swipeRef.current('right');
    else if (current.x < -THRESHOLD) swipeRef.current('left');
    else paint(0, 0, true);
  };

  const onTransitionEnd = (event: ReactTransitionEvent<HTMLElement>) => {
    if (event.propertyName !== 'transform' || event.target !== event.currentTarget) return;
    commitRef.current();
  };

  const parts = top ? splitIngredients(top, app.fridge) : null;
  const showMatch = app.fridge.length > 0 && parts !== null;
  let badge = '';
  let badgeKind = 'good';
  if (showMatch && parts) {
    if (parts.missing.length === 0) badge = 'Da się zrobić';
    else if (parts.missing.length === 1) {
      badge = 'Prawie wszystko jest';
      badgeKind = 'almost';
    } else {
      badge = `${parts.have.length} z ${parts.total} jest`;
      badgeKind = 'partial';
    }
  }

  let note = 'Przeglądaj przepisy — zdjęcie, nazwa i krótki skład';
  if (!app.hintSeen) note = 'Pociągnij w prawo, jeśli chcesz to ugotować';
  else if (app.strict && app.fridge.length > 0) note = 'Tylko to, co da się zrobić teraz';
  else if (app.fridge.length > 0) note = 'Najpierw przepisy bliższe lodówce';

  const remaining = visibleDeck(app.pool, app.fridge, app.liked, app.passed, false, [], [], [], 'wszystko', localAllergies);
  const best = unlockSuggestions(remaining, app.fridge)[0];
  const bestIngredient = best ? ingredientById(best.ingredientId) : undefined;
  const { ready } = countMatches(app.pool, app.fridge);
  const loading = !top && app.apiStatus === 'loading';
  // Signed in, some cards came from the server, but the last request failed.
  const feedError = !app.usingLocal && app.apiStatus === 'error';
  const sideLikes = app.liked
    .map((id) => app.getRecipe(id))
    .filter((recipe): recipe is Recipe => recipe !== undefined)
    .slice(0, 3);

  const owned = new Set(app.fridge);

  return (
    <div className="deck-screen">
      <div className="deck-layout">
        <aside className="side">
          <div className="panel">
            <div className="panel-head">
              <h2>Lodówka</h2>
              <button type="button" onClick={() => app.setScreen('fridge')}>
                Zmień
              </button>
            </div>
            {app.userId ? (
              app.pantry.length === 0 ? (
                <p>Zaznacz produkty — pokażemy przepisy, które z nich ugotujesz.</p>
              ) : (
                <div className="mini-chips">
                  {pantryProducts(app.pantry)
                    .slice(0, 8)
                    .map((members) => (
                      <span key={members[0]!.id}>{ingredientPl(members[0]!.name)}</span>
                    ))}
                  {pantryProducts(app.pantry).length > 8 && <span>+{pantryProducts(app.pantry).length - 8}</span>}
                </div>
              )
            ) : app.fridge.length === 0 ? (
              <p>Zaznacz produkty — na kartach pojawi się, czego brakuje.</p>
            ) : (
              <>
                <div className="mini-chips">
                  {app.fridge.slice(0, 8).map((id) => {
                    const item = ingredientById(id);
                    return item ? <span key={id}>{item.emoji} {item.name}</span> : null;
                  })}
                  {app.fridge.length > 8 && <span>+{app.fridge.length - 8}</span>}
                </div>
                <p className="panel-stat">
                  {ready} {plural(ready, 'przepis', 'przepisy', 'przepisów')} można ugotować
                  {app.strict ? ' · filtr włączony' : ''}
                </p>
              </>
            )}
          </div>
        </aside>

        <div className="stage">
          <p className="stage-note">{note}</p>
          {app.usingLocal &&
            (app.userId ? (
              <p className="stage-note">
                Brak połączenia z serwerem — pokazuję przykładowe przepisy.{' '}
                <button className="btn tiny quiet" type="button" onClick={app.retryApi}>
                  Spróbuj ponownie
                </button>
              </p>
            ) : (
              <p className="stage-note">
                Przykładowe przepisy.{' '}
                <button className="link" type="button" onClick={app.signOut}>
                  Zaloguj się
                </button>
                , żeby talia uczyła się Twojego gustu.
              </p>
            ))}
          {feedError && top && (
            <p className="stage-note" role="status">
              {app.apiErrorText || 'Nie udało się doładować kolejnych przepisów.'}{' '}
              <button className="btn tiny quiet" type="button" onClick={app.retryApi}>
                Spróbuj ponownie
              </button>
            </p>
          )}
          {!app.usingLocal && app.feedMode === 'calibration' && app.calibration && (
            <div
              className="calibration"
              role="progressbar"
              aria-label="Kalibracja gustu"
              aria-valuemin={0}
              aria-valuemax={app.calibration.required}
              aria-valuenow={app.calibration.current}
            >
              Poznajemy Twój gust: {app.calibration.current} z {app.calibration.required}
              <div className="calibration-bar">
                <i style={{ width: `${(app.calibration.current / app.calibration.required) * 100}%` }} />
              </div>
            </div>
          )}
          <div className="stack" ref={stackRef}>
            {top ? (
              <>
                {[...back].reverse().map((recipe) => (
                  <div key={recipe.id} className={recipe.id === back[0]?.id ? 'back d1' : 'back d2'} aria-hidden="true">
                    <Photo src={recipe.image} tint={recipe.tint} />
                  </div>
                ))}
                <article
                  key={top.id}
                  ref={topRef}
                  className="swipe"
                  style={{ background: top.tint }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={finishDrag}
                  onPointerCancel={finishDrag}
                  onLostPointerCapture={finishDrag}
                  onTransitionEnd={onTransitionEnd}
                >
                  <Photo src={top.image} tint={top.tint} />
                  <div className="shade" />
                  {badge && <p className={`badge ${badgeKind}`}>{badge}</p>}
                  <button className="info" type="button" onClick={() => setDetails(true)} aria-label="Więcej o składzie">
                    <IconInfo />
                  </button>
                  <p className="stamp stamp-like" aria-hidden="true">Mniam</p>
                  <p className="stamp stamp-nope" aria-hidden="true">Nie</p>
                  <div className="card-copy">
                    <p className="kicker">
                      {recipeKicker(top)}
                    </p>
                    <h2>{top.title}</h2>
                    <p className="tagline">{top.tagline}</p>
                    <div className="pills">
                      {top.ingredients.slice(0, 4).map((item) => {
                        const missing = app.fridge.length > 0 && !item.staple && !owned.has(item.id);
                        return (
                          <span key={item.id} className={missing ? 'pill missing' : 'pill'}>
                            {ingredientName(item)}
                          </span>
                        );
                      })}
                      {top.ingredients.length > 4 && <span className="pill">+{top.ingredients.length - 4}</span>}
                    </div>
                  </div>
                </article>
              </>
            ) : loading ? (
              <div className="empty-card" aria-busy="true">
                <p className="eyebrow">Talia</p>
                <h2>Szukam przepisów…</h2>
                <p>
                  {app.feedMode === 'personalized'
                    ? 'Dobieram karty do Twojego gustu. Pierwsze rekomendacje mogą potrwać do minuty.'
                    : 'Ładuję przepisy do oceny. Jeśli serwer dopiero się wybudza, może to potrwać do pół minuty.'}
                </p>
              </div>
            ) : (
              <div className="empty-card">
                <p className="eyebrow">Talia</p>
                <h2>{feedError ? 'Serwer nie odpowiada' : 'Na dziś tyle'}</h2>
                <p>
                  {feedError
                    ? `${app.apiErrorText || 'Nie udało się pobrać kolejnych przepisów.'} Spróbuj ponownie za chwilę.`
                    : app.strict && app.fridge.length > 0
                      ? 'Z tej lodówki przepisy się skończyły.'
                      : !app.usingLocal && app.exhausted
                        ? 'Serwer nie ma teraz nowych rekomendacji.'
                        : 'W talii nic już nie zostało.'}
                </p>
                <div className="empty-actions">
                  {(feedError || (!app.usingLocal && app.exhausted)) && (
                    <button className="btn solid" type="button" onClick={app.retryApi}>
                      {feedError ? 'Spróbuj ponownie' : 'Szukaj ponownie'}
                    </button>
                  )}
                  {app.strict && best && bestIngredient && (
                    <button className="btn solid" type="button" onClick={() => app.toggleFridge(best.ingredientId)}>
                      Dodaj {bestIngredient.name.toLowerCase()} — {best.recipeIds.length === 1 ? 'otworzy się' : 'otworzą się'}{' '}
                      {best.recipeIds.length} {plural(best.recipeIds.length, 'przepis', 'przepisy', 'przepisów')}
                    </button>
                  )}
                  {app.strict && (
                    <button className="btn ghost-dark" type="button" onClick={app.toggleStrict}>
                      Pokaż całą talię
                    </button>
                  )}
                  {app.passed.length > 0 && (
                    <button className="btn ghost-dark" type="button" onClick={app.restorePassed}>
                      Przywróć pominięte
                    </button>
                  )}
                  {app.liked.length > 0 && (
                    <button className="btn solid" type="button" onClick={() => app.setScreen('likes')}>
                      Otwórz polubione
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="actions">
            <button className="round nope" type="button" aria-label="Pomiń" disabled={!top} onClick={() => swipeRef.current('left')}>
              <IconNope size={22} />
            </button>
            <button
              className="round undo"
              type="button"
              aria-label="Wróć do poprzedniej karty"
              title="Wróć do poprzedniej karty"
              disabled={!app.canUndo}
              onClick={app.undo}
            >
              <IconUndo size={22} />
            </button>
            <button className="round like" type="button" aria-label="Lubię" disabled={!top} onClick={() => swipeRef.current('right')}>
              <IconHeart size={22} />
            </button>
          </div>
          <p className="kbd">Klawisze ← i → · U cofa</p>
        </div>

        <aside className="side">
          <div className="panel">
            <div className="panel-head">
              <h2>Polubione</h2>
              <button type="button" onClick={() => app.setScreen('likes')}>
                Wszystkie
              </button>
            </div>
            {sideLikes.length === 0 ? (
              <p>Swipe w prawo odkłada przepis tutaj — już z krokami i minutnikami.</p>
            ) : (
              <div className="mini-likes">
                {sideLikes.map((recipe) => (
                  <button key={recipe.id} type="button" className="mini-like" onClick={() => app.openCook(recipe.id)}>
                    <Photo src={recipe.image} tint={recipe.tint} />
                    <span>
                      <strong>{recipe.title}</strong>
                      <em>Gotuj</em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {details && top && (
        <Details
          recipe={top}
          fridge={app.fridge}
          onClose={() => setDetails(false)}
          onLike={() => {
            detailsRef.current = false;
            setDetails(false);
            swipeRef.current('right');
          }}
          onPass={() => {
            detailsRef.current = false;
            setDetails(false);
            swipeRef.current('left');
          }}
        />
      )}
      <div className="sr" aria-live="polite">{announce}</div>
    </div>
  );
}
