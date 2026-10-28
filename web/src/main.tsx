import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { assertRecipes } from './logic.ts';
import App from './App.tsx';
import './index.css';

assertRecipes();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
