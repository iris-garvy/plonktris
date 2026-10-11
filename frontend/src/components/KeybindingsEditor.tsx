import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react';
import {
  BINDING_ACTIONS, BINDING_LABELS, DEFAULT_BINDINGS, DEFAULT_HANDLING, HANDLING_LIMITS,
  isModifierKey, keyLabel, keySig, sanitizeHandling,
  type BindingAction, type Bindings, type Handling,
} from '../keybindings';
import './KeybindingsModal.css';

const ARROW_ICONS: Record<string, LucideIcon> = {
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
};

/** Renders a key binding: arrow keys as icons, everything else as text. */
function KeyCap({ binding }: { binding: string }) {
  if (!binding) return <span className="key-unbound">unbound</span>;
  const mod = binding.startsWith('mod+');
  const key = mod ? binding.slice(4) : binding;
  const Icon = ARROW_ICONS[key];
  return (
    <>
      {mod && <span className="key-mod">⌘/^</span>}
      {Icon ? <Icon className="key-icon" aria-label={key} /> : keyLabel(key)}
    </>
  );
}

interface HandlingRowProps {
  label: string;
  hint: string;
  field: keyof Handling;
  /** slider range (the number box accepts the full HANDLING_LIMITS range) */
  sliderMax: number;
  /** 0 means "instant" for this setting */
  instantAtZero?: boolean;
  handling: Handling;
  onChange: (next: Handling) => void;
}

function HandlingRow({ label, hint, field, sliderMax, instantAtZero, handling, onChange }: HandlingRowProps) {
  const value = handling[field];
  const [draft, setDraft] = useState<string | null>(null);
  const set = (v: number) => onChange(sanitizeHandling({ ...handling, [field]: v }));
  const id = `handling-${field}`;
  const instant = instantAtZero && value === 0;
  return (
    <div className="handling-row">
      <label className="handling-label" htmlFor={id}>
        <span className="handling-name">{label}</span>
        <span className="handling-hint">{hint}</span>
      </label>
      <div className="handling-controls">
        <input
          id={id}
          type="range"
          className="handling-slider"
          min={0}
          max={sliderMax}
          step={1}
          value={Math.min(value, sliderMax)}
          onChange={e => set(Number(e.target.value))}
        />
        <input
          type="number"
          className="handling-num"
          inputMode="numeric"
          min={HANDLING_LIMITS[field].min}
          max={HANDLING_LIMITS[field].max}
          value={draft ?? String(value)}
          aria-label={`${label} (ms)`}
          onChange={e => {
            setDraft(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(Number(e.target.value))) set(Number(e.target.value));
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <span className="handling-unit">ms</span>
        {!instantAtZero && <span className="handling-instant placeholder" aria-hidden="true">instant</span>}
        {instantAtZero && (
          <button
            type="button"
            className={`handling-instant${instant ? ' on' : ''}`}
            aria-pressed={instant}
            onClick={() => set(instant ? DEFAULT_HANDLING[field] || 10 : 0)}
            title={instant ? 'instant (click for the default)' : 'set to 0 = instant'}
          >
            instant
          </button>
        )}
      </div>
    </div>
  );
}

interface KeybindingsEditorProps {
  bindings: Bindings;
  onChange: (next: Bindings) => void;
  handling: Handling;
  onHandlingChange: (next: Handling) => void;
}

export default function KeybindingsEditor({ bindings, onChange, handling, onHandlingChange }: KeybindingsEditorProps) {
  const [listening, setListening] = useState<BindingAction | null>(null);

  useEffect(() => {
    if (!listening) return;
    const target = listening;
    // a modifier pressed and released on its own binds the modifier itself (e.g. Shift = hold)
    let pendingModifier: string | null = null;

    function bind(key: string) {
      const next = { ...bindings };
      // if the key is already bound elsewhere, swap so nothing goes unbound
      const conflict = BINDING_ACTIONS.find(a => next[a] === key && a !== target);
      if (conflict) next[conflict] = next[target];
      next[target] = key;
      onChange(next);
      setListening(null);
    }
    function onDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(null);
        return;
      }
      if (isModifierKey(e.key)) {
        pendingModifier = e.key;
        return;
      }
      pendingModifier = null;
      bind(keySig(e));
    }
    function onUp(e: KeyboardEvent) {
      if (pendingModifier && e.key === pendingModifier) {
        e.preventDefault();
        e.stopPropagation();
        bind(pendingModifier);
      }
    }
    function onPointer(e: PointerEvent) {
      // clicking anywhere except the listening button cancels
      if (!(e.target instanceof Element) || !e.target.closest('.keys-bind.listening')) setListening(null);
    }
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [listening, bindings, onChange]);

  return (
    <>
      <div className="keys-title">HANDLING</div>
      <div className="handling-list">
        <HandlingRow
          label="DAS" hint="delay before auto-shift" field="das" sliderMax={300}
          handling={handling} onChange={onHandlingChange}
        />
        <HandlingRow
          label="ARR" hint="auto-shift repeat · 0 = to the wall" field="arr" sliderMax={100} instantAtZero
          handling={handling} onChange={onHandlingChange}
        />
        <HandlingRow
          label="SOFT DROP" hint="per row · 0 = to the floor" field="softDrop" sliderMax={100} instantAtZero
          handling={handling} onChange={onHandlingChange}
        />
      </div>

      <div className="keys-title">KEYBINDINGS</div>
      <div className="keys-list">
        {BINDING_ACTIONS.map(action => (
          <div key={action} className="keys-row">
            <span className="keys-action">{BINDING_LABELS[action]}</span>
            <button
              type="button"
              className={`keys-bind ${listening === action ? 'listening' : ''}`}
              onClick={() => setListening(listening === action ? null : action)}
            >
              {listening === action ? 'press a key…' : <KeyCap binding={bindings[action]} />}
            </button>
          </div>
        ))}
      </div>
      {listening && <div className="keys-help">press the new key · esc cancels · a lone shift / ctrl / alt works too</div>}

      <button
        type="button"
        className="keys-reset"
        onClick={() => {
          onChange({ ...DEFAULT_BINDINGS });
          onHandlingChange({ ...DEFAULT_HANDLING });
        }}
      >
        reset to defaults
      </button>
    </>
  );
}
