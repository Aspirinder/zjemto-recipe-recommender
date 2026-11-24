import { categories, ingredients, sampleFridge } from '../data.ts';
import { ingredientById, splitIngredients } from '../logic.ts';
import { useApp } from '../state.tsx';
import { ServerFridge } from './ServerFridge.tsx';

/** Signed in: the backend's ingredient catalog and /api/recipes/fridge. Demo: the small local catalog. */
export function Fridge() {
  const { userId } = useApp();
  return userId ? <ServerFridge /> : <LocalFridge />;
}

function LocalFridge() {
  const { fridge, strict, toggleFridge, setFridge, clearFridge, toggleStrict, pool } = useApp();
  const owned = new Set(fridge);
  const near = pool
    .map((recipe) => ({ recipe, missing: splitIngredients(recipe, fridge).missing }))
    .filter((item) => item.missing.length === 1)
    .slice(0, 3);

  return (
    <section className="scroll-screen">
      <div className="page">
        <header className="page-intro">
          <p className="eyebrow">Lodówka</p>
          <h1>Co masz w domu</h1>
          <p>
            Zaznacz produkty. Talia podniesie przepisy, które złożysz od razu, a resztę
            zostawi niżej — z adnotacją, czego brakuje.
          </p>
        </header>

        <div className="fridge-tools">
          <button
            className={strict ? 'switch on' : 'switch'}
            type="button"
            role="switch"
            aria-checked={strict}
            onClick={toggleStrict}
          >
            <span />
            Tylko z tego, co jest
          </button>
          <div className="tool-row">
            <button className="btn tiny" type="button" onClick={() => setFridge(sampleFridge)}>
              Przykładowa lodówka
            </button>
            <button className="btn tiny quiet" type="button" onClick={clearFridge} disabled={fridge.length === 0}>
              Wyczyść
            </button>
          </div>
        </div>

        {fridge.length === 0 && (
          <p className="match-line">Pusto — talia pokazuje wszystko po kolei.</p>
        )}

        {fridge.length > 0 && near.length > 0 && (
          <ul className="near-list">
            {near.map(({ recipe, missing }) => {
              const lack = missing[0];
              const meta = lack ? ingredientById(lack.id) : undefined;
              // Ingredients outside the fridge catalog can't be added with one tap.
              if (!lack || !meta) return null;
              return (
                <li key={recipe.id}>
                  <div>
                    <strong>{recipe.title}</strong>
                    <span>brakuje: {meta.name.toLowerCase()}</span>
                  </div>
                  <button type="button" onClick={() => toggleFridge(lack.id)}>
                    Dodaj {meta.emoji}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="groups">
          {categories.map((category) => (
            <section key={category.id} className="group">
              <h2>{category.label}</h2>
              <div className="group-grid">
                {ingredients
                  .filter((item) => item.category === category.id)
                  .map((item) => {
                    const pressed = owned.has(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="ing"
                        aria-pressed={pressed}
                        onClick={() => toggleFridge(item.id)}
                      >
                        <span className="ing-emoji">{item.emoji}</span>
                        {item.name}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
