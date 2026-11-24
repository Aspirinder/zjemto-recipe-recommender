# ZjemTo — aplikacja webowa

Interfejs do przeglądania przepisów gestem swipe (React + TypeScript + Vite), połączony z ZjemTo API (`API.py`, wersja 8.0; bez „Lodówki” działa też z 7.0 i 6.0).
Autorka: Sofiya Krasouskaya (30999).

**Wersja online:** https://mulatkasofi.github.io/zjemto/ (GitHub Pages; działa, gdy API na Azure jest włączone).

Aktualizacja wersji online: `npx vite build --base=/zjemto/`, a zawartość `dist/` wypchnąć na gałąź `gh-pages`
repozytorium `mulatkasofi/zjemto`.

## Uruchomienie

```bash
npm install
npm run dev        # http://localhost:5173
```

Domyślnie aplikacja łączy się z API na Azure (`https://zjemto-api.azurewebsites.net`).
Instancja usypia się po przerwie, więc pierwsze żądanie trwa ~15–30 s. Ekran logowania od razu „budzi” serwer (`GET /`),
a gdy odpowiedź się przeciąga, pokazuje komunikat zamiast wyglądać na zawieszony.
Żeby użyć lokalnego backendu (`uvicorn API:app --reload`), utwórz `.env.local`:

```
VITE_API_URL=http://127.0.0.1:8000
```

Backend ma włączony CORS dla wszystkich adresów, więc przeglądarka łączy się z nim bezpośrednio.

## Przepływ w aplikacji

| Krok | Endpoint |
|---|---|
| Rejestracja / logowanie (e-mail + hasło); `user_id` zapisywany w `localStorage`, hasło nigdy | `POST /api/users/signup`, `POST /api/users/signin` |
| Po zalogowaniu wczytanie alergii | `GET /api/users/{user_id}/allergies` |
| Talia kart: najpierw kalibracja (pasek „Poznajemy Twój gust: x z 20”), potem rekomendacje — tryb wybiera serwer (`mode`) | `GET /api/recipes/feed/{user_id}` |
| Swipe w prawo / w lewo; `already_recorded` nie zwiększa postępu kalibracji; po 20. swipie talia przełącza się na rekomendacje | `POST /api/swipe` |
| Zmiana alergii w profilu — wysyłana cała lista, potem talia jest pobierana od nowa | `PUT /api/users/{user_id}/allergies` |
| „Polubione” z serwera (te same na każdym urządzeniu) — przy logowaniu i przy wejściu w zakładkę | `GET /api/users/{user_id}/liked-recipes` |
| Usunięcie z polubionych i „cofnij” po lajku | `DELETE /api/users/{user_id}/liked-recipes/{recipe_id}` |
| „Lodówka” (zalogowani): lista ~1050 produktów pobierana raz, wyszukiwanie po nazwie (angielskiej lub polskiej z lokalnego katalogu) | `GET /api/ingredients/groups` |
| „Pokaż przepisy” z zaznaczonych produktów; „Może brakować: Nic / Do 1 / Do 2” = `max_missing`; w trakcie (do ~5 s) animacja garnka i szkielety kart | `POST /api/recipes/fridge/{user_id}` |
| Kroki z `instructions` w trybie gotowania; minutnik z tekstu kroku („Bake 30-35 minutes” → 30:00); opis, kategoria, kcal i makro w szczegółach | pola przepisu z `/feed` i `/liked-recipes` |

Alergie to tagi z backendu: `gluten`, `dairy`, `eggs`, `nuts`, `seafood`.

Bez konta można obejrzeć przykładowe przepisy (`src/data.ts`); te same przepisy pokazują się, gdy serwer nie odpowiada.

## Pliki

- `src/api.ts` — klient API i mapowanie przepisu z bazy (Food.com) na model interfejsu: zdjęcie z formatu `c("...")`, czas z `PT1H15M`, składniki dopasowane do produktów z „Lodówki”.
- `src/ingredientsPl.ts` — polskie nazwy wszystkich ~1050 produktów z `/api/ingredients/groups` (klucz: angielska `canonical_name`; brak tłumaczenia = nazwa angielska).
- `src/components/ServerFridge.tsx` — „Lodówka” dla zalogowanych: wyszukiwanie (po polsku i angielsku), warianty pisowni („walnut”/„walnuts”) jako jeden produkt, wyniki, „Pokaż więcej” (do 50).
- `src/state.tsx` — stan aplikacji: konto, talia z API (doładowanie, gdy zostaje < 5 kart), kolejka swipe'ów (talia pobierana jest dopiero po zapisaniu swipe'ów), alergie.
- `src/components/Auth.tsx` — ekran logowania i rejestracji.

## Ograniczenia API (stan na 24.11, v8)

- v8 zamiast `carbs` zwraca `sugar` — w szczegółach pokazujemy to, co przyszło (cukier albo węglowodany),
- „Lodówka” wymaga ukończonej kalibracji (20 swipe'ów) — wcześniej serwer zwraca 409,
- odpowiedź `/api/recipes/fridge` podaje tylko liczbę brakujących składników (`missing_count`, `total_required`), bez nazw,
- nazwy produktów w bazie są angielskie — tłumaczenie jest po stronie aplikacji (`src/ingredientsPl.ts`),

### Wcześniejsze (v7)


- brak liczby porcji; `ingredient_quantities` nie pasują 1:1 do `ingredient_parts` (dane Food.com), więc ilości nie są pokazywane,
- około 60–75% przepisów nie ma zdjęcia (`image_url: null`) — wtedy karta ma gradient z ikoną talerza,
- brak cofnięcia swipe'a na serwerze — „cofnij” usuwa przepis z polubionych, ale swipe zostaje w `user_swipes`,
- brak tokenów/sesji — `user_id` po zalogowaniu nie jest zabezpieczeniem (prototyp).

## Skrypty

- `npm run dev` — serwer deweloperski
- `npm run build` — sprawdzenie typów i build do `dist/`
- `npm run lint` — oxlint
