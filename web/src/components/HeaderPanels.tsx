import { useEffect, useRef } from 'react';
import { categories, ingredients } from '../data.ts';
import { plural } from '../logic.ts';
import { useApp } from '../state.tsx';
import { IconClose } from './icons.tsx';

function useDismiss(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return closeRef;
}

export function TasteSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const closeRef = useDismiss(onClose);
  const loved = new Set(app.loved);
  const avoided = new Set(app.avoided);
  const picked = app.loved.length + app.avoided.length;

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet plain-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="taste-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <p className="eyebrow">Filtr</p>
            <h2 id="taste-title">Smak</h2>
          </div>
          <button ref={closeRef} className="icon-btn light" type="button" onClick={onClose} aria-label="Zamknij">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          <p>
            Kliknij raz, jeśli lubisz. Drugi raz — jeśli nie. Przepisy z tym, czego nie chcesz, znikają z talii, a
            ulubione produkty idą wyżej.
          </p>
          <div className="taste-legend">
            <span className="taste-chip love">Lubię</span>
            <span className="taste-chip avoid">Nie lubię</span>
          </div>
          {categories.map((category) => (
            <section key={category.id} className="taste-group">
              <h3>{category.label}</h3>
              <div className="taste-chips">
                {ingredients
                  .filter((item) => item.category === category.id)
                  .map((item) => {
                    const taste = loved.has(item.id) ? 'love' : avoided.has(item.id) ? 'avoid' : 'off';
                    const next = taste === 'off' ? 'love' : taste === 'love' ? 'avoid' : 'off';
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={taste === 'off' ? 'taste-chip' : `taste-chip ${taste}`}
                        aria-pressed={taste !== 'off'}
                        onClick={() => app.setTaste(item.id, next)}
                      >
                        {item.emoji} {item.name}
                        {taste === 'love' ? ' · lubię' : taste === 'avoid' ? ' · nie' : ''}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="btn ghost" type="button" onClick={app.clearTaste} disabled={picked === 0}>
            Wyczyść
          </button>
          <button className="btn solid" type="button" onClick={onClose}>
            Pokaż talię
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const closeRef = useDismiss(onClose);
  const name = app.profileName.trim();

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet plain-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <p className="eyebrow">Konto</p>
            <h2 id="profile-title">{name || 'Twój profil'}</h2>
          </div>
          <button ref={closeRef} className="icon-btn light" type="button" onClick={onClose} aria-label="Zamknij">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          <label className="name-field">
            Imię
            <input
              value={app.profileName}
              maxLength={32}
              placeholder="Twoje imię"
              autoComplete="nickname"
              onChange={(event) => app.setProfileName(event.target.value)}
            />
          </label>
          <ul className="profile-stats">
            <li>
              <strong>{app.liked.length}</strong>
              <span>{plural(app.liked.length, 'polubiony przepis', 'polubione przepisy', 'polubionych przepisów')}</span>
            </li>
            <li>
              <strong>{app.fridge.length}</strong>
              <span>{plural(app.fridge.length, 'produkt w lodówce', 'produkty w lodówce', 'produktów w lodówce')}</span>
            </li>
            <li>
              <strong>{app.loved.length}</strong>
              <span>{plural(app.loved.length, 'ulubiony smak', 'ulubione smaki', 'ulubionych smaków')}</span>
            </li>
            <li>
              <strong>{app.avoided.length}</strong>
              <span>{plural(app.avoided.length, 'smak do omijania', 'smaki do omijania', 'smaków do omijania')}</span>
            </li>
          </ul>
          <p className="profile-note">Imię zostaje na tym telefonie. Przepisy i smak też.</p>
        </div>
      </div>
    </div>
  );
}
