import { useEffect, useRef, useState } from 'react';
import type { Recipe } from '../types.ts';
import { formatClock, ingredientById, plural } from '../logic.ts';
import { IconClose } from './icons.tsx';

const stepMemory = new Map<string, number>();
let sharedAudio: AudioContext | null = null;

function chime() {
  const audio = sharedAudio;
  if (!audio) return;
  const now = audio.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, index) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(audio.destination);
    const start = now + index * 0.11;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.05, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.start(start);
    osc.stop(start + 0.34);
  });
  navigator.vibrate?.(160);
}

function ensureAudio() {
  if (!sharedAudio) sharedAudio = new AudioContext();
  if (sharedAudio.state === 'suspended') void sharedAudio.resume();
}

type TimerProps = {
  seconds: number;
  label: string;
};

function Timer({ seconds, label }: TimerProps) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const leftRef = useRef(seconds);
  const doneRef = useRef(false);
  const done = left <= 0;

  useEffect(() => {
    if (!running) return;
    const end = Date.now() + leftRef.current * 1000;
    const id = window.setInterval(() => {
      const next = Math.max(0, (end - Date.now()) / 1000);
      leftRef.current = next;
      setLeft(next);
      if (next <= 0) {
        setRunning(false);
        if (!doneRef.current) {
          doneRef.current = true;
          chime();
        }
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [running]);

  const reset = () => {
    leftRef.current = seconds;
    doneRef.current = false;
    setLeft(seconds);
    setRunning(false);
  };

  const toggle = () => {
    ensureAudio();
    if (leftRef.current <= 0) {
      leftRef.current = seconds;
      doneRef.current = false;
      setLeft(seconds);
      setRunning(true);
      return;
    }
    setRunning((value) => !value);
  };

  const radius = 86;
  const circ = 2 * Math.PI * radius;
  const remaining = seconds === 0 ? 0 : Math.max(0, left) / seconds;

  return (
    <div className={done ? 'timer done' : 'timer'}>
      <div className="timer-face">
      <svg viewBox="0 0 220 220" aria-hidden="true">
        <circle className="ring-track" cx="110" cy="110" r={radius} />
        <circle
          className="ring-value"
          cx="110"
          cy="110"
          r={radius}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - remaining)}
          transform="rotate(-90 110 110)"
        />
      </svg>
      <div className="timer-readout">
        <strong>{done ? '0:00' : formatClock(left)}</strong>
        <span>{done ? 'Gotowe' : label}</span>
      </div>
      </div>
      <div className="timer-actions">
        <button className="btn flame" type="button" onClick={toggle}>
          {done ? 'Jeszcze raz' : running ? 'Pauza' : 'Start'}
        </button>
        <button className="btn ghost" type="button" onClick={reset}>
          Reset
        </button>
      </div>
    </div>
  );
}

type CookProps = {
  recipe: Recipe;
  onClose: () => void;
};

export function Cook({ recipe, onClose }: CookProps) {
  const [stepIndex, setStepIndex] = useState(() => stepMemory.get(recipe.id) ?? 0);
  const [finished, setFinished] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const step = recipe.steps[stepIndex] ?? recipe.steps[0];

  useEffect(() => {
    stepMemory.set(recipe.id, stepIndex);
  }, [recipe.id, stepIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = (next: number) => {
    setFinished(false);
    setStepIndex(Math.max(0, Math.min(recipe.steps.length - 1, next)));
  };

  if (!step) return null;

  return (
    <section className="cook" role="dialog" aria-modal="true" aria-labelledby="cook-title">
      <header className="cook-top">
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Zamknij gotowanie">
          <IconClose />
        </button>
        <div>
          <p className="step-kicker">{finished ? 'Na stole' : `Krok ${stepIndex + 1} z ${recipe.steps.length}`}</p>
          <h2 id="cook-title">{recipe.title}</h2>
        </div>
      </header>

      <div className="progress" aria-hidden="true">
        {recipe.steps.map((_, index) => (
          <span key={`${recipe.id}-${index}`} className={finished || index <= stepIndex ? 'on' : ''} />
        ))}
      </div>

      {finished ? (
        <div className="cook-body done-body">
          <p className="serve">Zjem to</p>
          <h3>Smacznego</h3>
          <p>{recipe.title} można nieść na stół. Jeśli chcesz przejść kroki jeszcze raz — są na miejscu.</p>
          <button className="btn flame" type="button" onClick={onClose}>
            Do polubionych
          </button>
        </div>
      ) : (
        <div className="cook-body">
          <p className="step-text">{step.text}</p>
          {step.timer ? (
            <Timer key={`${recipe.id}-${stepIndex}`} seconds={step.timer.seconds} label={step.timer.label} />
          ) : (
            <p className="no-timer">Na tym kroku minutnik nie jest potrzebny — zrób to i idź dalej.</p>
          )}
        </div>
      )}

      <div className="cook-foot">
        <button className="list-toggle" type="button" aria-expanded={listOpen} onClick={() => setListOpen((value) => !value)}>
          Skład · {recipe.ingredients.length} {plural(recipe.ingredients.length, 'produkt', 'produkty', 'produktów')}
        </button>
        {listOpen && (
          <ul className="cook-list">
            {recipe.ingredients.map((item) => {
              const meta = ingredientById(item.id);
              const on = checked.includes(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={on ? 'check on' : 'check'}
                    aria-pressed={on}
                    onClick={() =>
                      setChecked((current) =>
                        current.includes(item.id)
                          ? current.filter((id) => id !== item.id)
                          : [...current, item.id],
                      )
                    }
                  >
                    <i />
                    <span>
                      {meta?.name ?? item.id}
                      <em>{item.amount}</em>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!finished && (
          <div className="cook-nav">
            <button className="btn ghost" type="button" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0}>
              Wstecz
            </button>
            <button
              className="btn flame"
              type="button"
              onClick={() => {
                if (stepIndex === recipe.steps.length - 1) setFinished(true);
                else go(stepIndex + 1);
              }}
            >
              {stepIndex === recipe.steps.length - 1 ? 'Gotowe' : 'Dalej'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
