import { categories, ingredients, recipes, sampleFridge } from '../data.ts';
import { countMatches, ingredientById, plural, splitIngredients } from '../logic.ts';
import { useApp } from '../state.tsx';

export function Fridge() {
  const { fridge, strict, toggleFridge, setFridge, clearFridge, toggleStrict } = useApp();
  const owned = new Set(fridge);
  const { ready, almost } = countMatches(fridge);
  const near = recipes
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

        <p className="match-line">
          {fridge.length === 0
            ? 'Pusto — talia pokazuje wszystko po kolei.'
            : `Można ugotować ${ready} ${plural(ready, 'przepis', 'przepisy', 'przepisów')} · jeszcze ${almost} prawie`}
        </p>

        {fridge.length > 0 && near.length > 0 && (
          <ul className="near-list">
            {near.map(({ recipe, missing }) => {
              const lack = missing[0];
              const meta = lack ? ingredientById(lack.id) : undefined;
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
