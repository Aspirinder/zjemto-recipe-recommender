import { useEffect, useRef } from 'react';
import type { Recipe } from '../types.ts';
import { ingredientById, plural, splitIngredients } from '../logic.ts';
import { IconClose } from './icons.tsx';
import { Photo } from './Photo.tsx';

type DetailsProps = {
  recipe: Recipe;
  fridge: readonly string[];
  onClose: () => void;
  onLike: () => void;
  onPass: () => void;
};

export function Details({ recipe, fridge, onClose, onLike, onPass }: DetailsProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const parts = splitIngredients(recipe, fridge);
  const timers = recipe.steps.filter((step) => step.timer).length;
  const showMatch = fridge.length > 0;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-photo">
          <Photo src={recipe.image} tint={recipe.tint} />
          <button ref={closeRef} className="icon-btn light" type="button" onClick={onClose} aria-label="Zamknij">
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          <p className="kicker dark">
            {recipe.cuisine} · {recipe.minutes} min · {recipe.servings}{' '}
            {plural(recipe.servings, 'porcja', 'porcje', 'porcji')}
          </p>
          <h2 id="details-title">{recipe.title}</h2>
          <p className="lede">{recipe.tagline}</p>
          <p className="tease">
            {recipe.steps.length} {plural(recipe.steps.length, 'krok', 'kroki', 'kroków')}
            {timers > 0 ? ` i ${timers} ${plural(timers, 'minutnik', 'minutniki', 'minutników')}` : ''}. Gotowanie
            krok po kroku otworzy się w polubionych.
          </p>
          <ul className="ingredient-list">
            {recipe.ingredients.map((item) => {
              const meta = ingredientById(item.id);
              const owned = !showMatch || parts.have.some((have) => have.id === item.id);
              return (
                <li key={item.id} className={owned ? 'owned' : 'absent'}>
                  <span>
                    {meta?.emoji} {meta?.name ?? item.id}
                  </span>
                  <em>
                    {item.amount}
                    {showMatch && !owned ? ' · nie ma w domu' : ''}
                  </em>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="sheet-actions">
          <button className="btn ghost-dark" type="button" onClick={onPass}>
            Nie
          </button>
          <button className="btn solid" type="button" onClick={onLike}>
            Chcę ugotować
          </button>
        </div>
      </div>
    </div>
  );
}
