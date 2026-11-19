import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, wakeServer, whenSlow } from '../api.ts';
import { allergens } from '../data.ts';
import { useApp, type AuthKind } from '../state.tsx';
import { Mark } from './icons.tsx';

const MIN_PASSWORD = 6;

function authMessage(error: unknown, kind: AuthKind) {
  if (!(error instanceof ApiError)) return 'Coś poszło nie tak. Spróbuj jeszcze raz.';
  switch (error.status) {
    case 0:
      return 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.';
    case 401:
      return 'Nieprawidłowy e-mail lub hasło.';
    case 409:
      return 'Konto z tym adresem już istnieje.';
    case 422:
      return 'Sprawdź adres e-mail — wygląda na niepoprawny.';
    default:
      return kind === 'signup'
        ? 'Nie udało się założyć konta. Spróbuj za chwilę.'
        : 'Nie udało się zalogować. Spróbuj za chwilę.';
  }
}

export function Auth() {
  const app = useApp();
  const [kind, setKind] = useState<AuthKind>('signin');
  const [email, setEmail] = useState(app.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [slow, setSlow] = useState(false);
  const [allergies, setAllergies] = useState<string[]>([]);

  // Wake the (possibly sleeping) server while the user is still typing.
  useEffect(() => {
    void wakeServer();
  }, []);

  const signup = kind === 'signup';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (signup && password.length < MIN_PASSWORD) {
      setError(`Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków.`);
      return;
    }
    setBusy(true);
    setError('');
    setConflict(false);
    setSlow(false);
    const attempt = app.authenticate(kind, email, password, signup ? allergies : undefined);
    const cancelSlow = whenSlow(attempt, 4000, () => setSlow(true));
    try {
      await attempt;
    } catch (caught) {
      setError(authMessage(caught, kind));
      setConflict(caught instanceof ApiError && caught.status === 409);
      setPassword('');
    } finally {
      cancelSlow();
      setBusy(false);
      setSlow(false);
    }
  };

  const switchKind = (next: AuthKind) => {
    setKind(next);
    setError('');
    setConflict(false);
  };

  return (
    <section className="auth-screen">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-brand">
          <Mark />
          <span>ZjemTo</span>
        </div>
        <h1>{signup ? 'Załóż konto' : 'Zaloguj się'}</h1>
        <p className="auth-lede">
          {signup
            ? 'Najpierw ocenisz 20 przepisów — z nich poznamy Twój gust. Potem talia dobiera się sama.'
            : 'Twoje polubienia i alergie są zapisane na koncie.'}
        </p>

        {app.authNotice && <p className="auth-notice">{app.authNotice}</p>}

        <label className="name-field">
          E-mail
          <input
            type="email"
            value={email}
            required
            autoComplete="email"
            inputMode="email"
            placeholder="ty@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="name-field">
          Hasło
          <input
            type="password"
            value={password}
            required
            minLength={signup ? MIN_PASSWORD : undefined}
            autoComplete={signup ? 'new-password' : 'current-password'}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {signup && (
          <fieldset className="auth-allergies">
            <legend>Alergie (opcjonalnie)</legend>
            <div className="taste-chips">
              {allergens.map((item) => {
                const on = allergies.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={on ? 'taste-chip avoid' : 'taste-chip'}
                    aria-pressed={on}
                    onClick={() =>
                      setAllergies((current) => (on ? current.filter((id) => id !== item.id) : [...current, item.id]))
                    }
                  >
                    {item.label}
                    {on ? ' · bez' : ''}
                  </button>
                );
              })}
            </div>
            <p className="auth-hint">Przepisy z tymi składnikami nie trafią do talii. Zmienisz to później w profilu.</p>
          </fieldset>
        )}

        {busy && slow && (
          <p className="auth-notice" role="status">
            Serwer się wybudza po przerwie — to może potrwać do pół minuty.
          </p>
        )}

        {error && (
          <p className="auth-error" role="alert">
            {error}{' '}
            {conflict && (
              <button className="link" type="button" onClick={() => switchKind('signin')}>
                Zaloguj się
              </button>
            )}
          </p>
        )}

        <button className="btn solid auth-submit" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? 'Chwila…' : signup ? 'Załóż konto' : 'Zaloguj się'}
        </button>

        <p className="auth-switch">
          {signup ? 'Masz już konto?' : 'Pierwszy raz tutaj?'}{' '}
          <button className="link" type="button" onClick={() => switchKind(signup ? 'signin' : 'signup')}>
            {signup ? 'Zaloguj się' : 'Załóż konto'}
          </button>
        </p>
        <p className="auth-switch">
          <button className="link quiet" type="button" onClick={app.enterDemo}>
            Zobacz przykładowe przepisy bez konta
          </button>
        </p>
      </form>
    </section>
  );
}
