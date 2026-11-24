import { useEffect, useRef } from 'react';
import { allergens } from '../data.ts';
import { pantryProducts, plural } from '../logic.ts';
import { useApp } from '../state.tsx';
import { IconClose } from './icons.tsx';

function useDismiss(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
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

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  // Signed in, several groups can map onto one catalog product — count what the user actually selected.
  const fridgeCount = app.userId ? pantryProducts(app.pantry).length : app.fridge.length;
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
              <strong>{fridgeCount}</strong>
              <span>{plural(fridgeCount, 'produkt w lodówce', 'produkty w lodówce', 'produktów w lodówce')}</span>
            </li>
          </ul>
          {app.email && <p className="profile-email">{app.email}</p>}

          <section className="taste-group">
            <h3>Alergie</h3>
            <div className="taste-chips">
              {allergens.map((item) => {
                const on = app.allergies.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={on ? 'taste-chip avoid' : 'taste-chip'}
                    aria-pressed={on}
                    onClick={() => app.toggleAllergy(item.id)}
                  >
                    {item.label}
                    {on ? ' · bez' : ''}
                  </button>
                );
              })}
            </div>
          </section>
          {app.allergyError && (
            <p className="form-error" role="alert">
              {app.allergyError}
            </p>
          )}
          <p className="profile-note">
            {app.userId
              ? 'Przepisy z zaznaczonymi alergenami nie trafią do talii. Filtr opiera się na składnikach z bazy — przy ciężkiej alergii zawsze sprawdź skład.'
              : 'Bez konta alergie działają tylko na przykładowych przepisach.'}
          </p>

          <div className="profile-actions">
            {app.userId ? (
              <button className="btn quiet" type="button" onClick={app.signOut}>
                Wyloguj się
              </button>
            ) : (
              <button className="btn solid" type="button" onClick={app.signOut}>
                Zaloguj się lub załóż konto
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
