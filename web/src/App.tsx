import { useEffect } from 'react';
import type { Screen } from './types.ts';
import { recipes } from './data.ts';
import { plural } from './logic.ts';
import { AppStateProvider, useApp } from './state.tsx';
import { Deck } from './components/Deck.tsx';
import { Fridge } from './components/Fridge.tsx';
import { Likes } from './components/Likes.tsx';
import { Cook } from './components/Cook.tsx';
import { IconDeck, IconFridge, IconHeart, Mark } from './components/icons.tsx';

const tabs: { id: Screen; label: string; Icon: typeof IconDeck }[] = [
  { id: 'deck', label: 'Odkrywaj', Icon: IconDeck },
  { id: 'fridge', label: 'Lodówka', Icon: IconFridge },
  { id: 'likes', label: 'Polubione', Icon: IconHeart },
];

function Shell() {
  const app = useApp();
  const cooking = recipes.find((recipe) => recipe.id === app.cookingId) ?? null;

  useEffect(() => {
    if (!cooking) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [cooking]);

  return (
    <div className="app">
      <header className="header">
        <button className="brand" type="button" onClick={() => app.setScreen('deck')}>
          <Mark />
          <span>Zjem to</span>
        </button>
        <nav className="header-nav" aria-label="Sekcje">
          {tabs.map(({ id, label }) => (
            <button key={id} type="button" aria-current={app.screen === id ? 'page' : undefined} onClick={() => app.setScreen(id)}>
              {label}
              {id === 'likes' && app.liked.length > 0 ? ` ${app.liked.length}` : ''}
            </button>
          ))}
        </nav>
        <p className="header-note">
          {app.liked.length === 0
            ? 'jeszcze pusto'
            : `${app.liked.length} ${plural(app.liked.length, 'polubiony', 'polubione', 'polubionych')}`}
        </p>
      </header>

      <main>
        {app.screen === 'deck' && <Deck />}
        {app.screen === 'fridge' && <Fridge />}
        {app.screen === 'likes' && <Likes />}
      </main>

      <nav className="tabbar" aria-label="Sekcje">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-current={app.screen === id ? 'page' : undefined} onClick={() => app.setScreen(id)}>
            <span className="tab-icon">
              <Icon />
              {id === 'likes' && app.liked.length > 0 && <em>{app.liked.length}</em>}
              {id === 'fridge' && app.fridge.length > 0 && <i />}
            </span>
            {label}
          </button>
        ))}
      </nav>

      {cooking && <Cook recipe={cooking} onClose={app.closeCook} />}
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
