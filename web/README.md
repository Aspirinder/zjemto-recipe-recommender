# ZjemTo — aplikacja webowa

Interfejs do przeglądania przepisów gestem swipe (React + TypeScript + Vite).
Autorka: Sofiya Krasouskaya (30999).

## Uruchomienie

```bash
cd web
npm install
cp .env.example .env.local   # ustaw VITE_API_URL na adres backendu (API.py)
npm run dev                  # http://localhost:5173
```

Lokalny backend: `uvicorn API:app --reload` w katalogu głównym repozytorium (domyślnie `http://127.0.0.1:8000`).

W trybie deweloperskim Vite przekierowuje zapytania `/api/*` na `VITE_API_URL` (`vite.config.ts`), więc backend nie potrzebuje CORS.
Zbudowana wersja (`npm run build`) łączy się bezpośrednio z `VITE_API_URL`, więc wtedy backend musi zezwolić na domenę frontendu (CORS).

## Połączenie z API

| Akcja w interfejsie | Endpoint |
|---|---|
| Pierwsze uruchomienie — utworzenie użytkownika (`user_id` zapisywany w `localStorage`) | `POST /api/users/init` |
| Talia kart (kalibracja, potem rekomendacje); doładowanie, gdy zostaje < 5 kart | `GET /api/recipe/personalized/{user_id}` |
| Swipe w prawo / w lewo | `POST /api/swipe` (`like` / `dislike`) |

- `src/api.ts` — klient API i mapowanie przepisu z bazy (Food.com) na model interfejsu: zdjęcie z formatu `c("...")`, czas z `PT1H15M`, składniki dopasowane do produktów z „Lodówki”.
- `src/state.tsx` — stan aplikacji: użytkownik, talia z API, kolejka swipe'ów (rekomendacje pobierane są dopiero po zapisaniu swipe'ów).
- Gdy serwer nie odpowiada, aplikacja pokazuje lokalne przepisy przykładowe (`src/data.ts`) i przycisk „Spróbuj ponownie”.

## Czego jeszcze brakuje po stronie API

- kroków przygotowania i liczby porcji (tryb gotowania pokazuje na razie listę składników),
- endpointu do cofnięcia swipe'a (cofnięcie działa tylko lokalnie),
- endpointu do zapisania alergii użytkownika (backend już filtruje po `users.allergies`, ale z interfejsu nie da się ich ustawić),
- CORS dla wersji produkcyjnej.

## Skrypty

- `npm run dev` — serwer deweloperski
- `npm run build` — sprawdzenie typów i build do `dist/`
- `npm run lint` — oxlint
