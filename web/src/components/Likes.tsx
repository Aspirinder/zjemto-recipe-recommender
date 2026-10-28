import type { Recipe } from '../types.ts';
import { plural, recipeById } from '../logic.ts';
import { useApp } from '../state.tsx';
import { IconClose } from './icons.tsx';
import { Photo } from './Photo.tsx';

export function Likes() {
  const { liked, unlike, openCook, setScreen } = useApp();
  const items = liked
    .map((id) => recipeById(id))
    .filter((recipe): recipe is Recipe => recipe !== undefined);

  if (items.length === 0) {
    return (
      <section className="scroll-screen">
        <div className="page empty-page">
          <div className="empty-mark" aria-hidden="true" />
          <h1>Na razie cicho</h1>
          <p>Przesuń w prawo przepisy, które chcesz postawić na kuchence. Zbiorą się tutaj, już z krokami i minutnikami.</p>
          <button className="btn solid" type="button" onClick={() => setScreen('deck')}>
            Do talii
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="scroll-screen">
      <div className="page">
        <header className="page-intro">
          <p className="eyebrow">Zapisane</p>
          <h1>Polubione</h1>
          <p>Kliknij kartę — otworzy się gotowanie krok po kroku. Przy każdym kroku jest minutnik, jeśli jest potrzebny.</p>
        </header>
        <div className="likes-grid">
          {items.map((recipe) => (
            <article key={recipe.id} className="like-card">
              <button className="like-open" type="button" onClick={() => openCook(recipe.id)}>
                <Photo src={recipe.image} tint={recipe.tint} alt="" />
                <span className="like-meta">
                  <strong>{recipe.title}</strong>
                  <em>
                    {recipe.minutes} min · {recipe.steps.length} {plural(recipe.steps.length, 'krok', 'kroki', 'kroków')}
                  </em>
                </span>
              </button>
              <button
                className="unlike"
                type="button"
                aria-label={`Usuń ${recipe.title} z polubionych`}
                onClick={() => unlike(recipe.id)}
              >
                <IconClose size={16} />
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
