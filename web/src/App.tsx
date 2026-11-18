import { useEffect, useState } from 'react';
import type { Screen } from './types.ts';
import { AppStateProvider, useApp } from './state.tsx';
import { Deck } from './components/Deck.tsx';
import { Fridge } from './components/Fridge.tsx';
import { Likes } from './components/Likes.tsx';
import { Cook } from './components/Cook.tsx';
import { Auth } from './components/Auth.tsx';
import { ProfileSheet, TasteSheet } from './components/HeaderPanels.tsx';
import { IconDeck, IconFilter, IconFridge, IconHeart, IconUser, Mark } from './components/icons.tsx';

const tabs: { id: Screen; label: string; Icon: typeof IconDeck }[] = [
  { id: 'deck', label: 'Odkrywaj', Icon: IconDeck },
  { id: 'fridge', label: 'Lodówka', Icon: IconFridge },
  { id: 'likes', label: 'Polubione', Icon: IconHeart },
];

function Shell() {
  const app = useApp();
  const cooking = (app.cookingId && app.getRecipe(app.cookingId)) || null;
  const [panel, setPanel] = useState<'taste' | 'profile' | null>(null);
  const tasteCount = app.loved.length + app.avoided.length;
  const initial = (app.profileName.trim() || app.email).charAt(0).toUpperCase();

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
          <span>ZjemTo</span>
        </button>
        <nav className="header-nav" aria-label="Sekcje">
          {tabs.map(({ id, label }) => (
            <button key={id} type="button" aria-current={app.screen === id ? 'page' : undefined} onClick={() => app.setScreen(id)}>
              {label}
              {id === 'likes' && app.liked.length > 0 ? ` ${app.liked.length}` : ''}
            </button>
          ))}
        </nav>
        <div className="header-tools">
          <button
            className="tool"
            type="button"
            aria-label="Filtr smaku"
            aria-expanded={panel === 'taste'}
            onClick={() => setPanel('taste')}
          >
            <IconFilter />
            {tasteCount > 0 && <em>{tasteCount}</em>}
          </button>
          <button className="avatar" type="button" aria-label="Profil" onClick={() => setPanel('profile')}>
            {initial ? initial : <IconUser size={18} />}
          </button>
        </div>
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
      {panel === 'taste' && <TasteSheet onClose={() => setPanel(null)} />}
      {panel === 'profile' && <ProfileSheet onClose={() => setPanel(null)} />}
    </div>
  );
}

// Separate component so that signing out unmounts Shell and resets its local UI state (open sheets etc.).
function Gate() {
  const app = useApp();
  if (!app.userId && !app.demo) return <Auth />;
  return <Shell key={app.userId ?? 'demo'} />;
}

export default function App() {
  return (
    <AppStateProvider>
      <Gate />
    </AppStateProvider>
  );
}
