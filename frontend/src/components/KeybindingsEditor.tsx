import { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, type LucideIcon } from 'lucide-react';
import {
  BINDING_LABELS, DEFAULT_BINDINGS, DEFAULT_HANDLING, keyLabel, keySig,
  type BindingAction, type Bindings, type Handling,
} from '../keybindings';
import './KeybindingsModal.css';

const ARROW_ICONS: Record<string, LucideIcon> = {
  ArrowLeft, ArrowRight, ArrowUp, ArrowDown,
};

/** Renders a key binding: arrow keys as icons, everything else as text. */
function KeyCap({ binding }: { binding: string }) {
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

function clamp(value: string | number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
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
    function onKey(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setListening(null);
        return;
      }
      // pure modifier presses keep listening for the real key
      if (['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) return;
      const key = keySig(e);
      const next = { ...bindings };
      // if the key is already bound elsewhere, swap so nothing goes unbound
      const actions = Object.keys(next) as BindingAction[];
      const conflict = actions.find(a => next[a] === key && a !== listening);
      if (conflict && listening) next[conflict] = next[listening];
      if (listening) next[listening] = key;
      onChange(next);
      setListening(null);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, bindings, onChange]);

  return (
    <>
      <div className="keys-title">KEYBINDINGS</div>

      <div className="keys-list">
        {(Object.keys(BINDING_LABELS) as BindingAction[]).map(action => (
          <div key={action} className="keys-row">
            <span className="keys-action">{BINDING_LABELS[action]}</span>
            <button
              className={`keys-bind ${listening === action ? 'listening' : ''}`}
              onClick={() => setListening(listening === action ? null : action)}
            >
              {listening === action ? 'press a key…' : <KeyCap binding={bindings[action]} />}
            </button>
          </div>
        ))}
      </div>

      <div className="keys-title">HANDLING</div>

      <div className="keys-list">
        <div className="keys-row">
          <span className="keys-action">DAS <span className="keys-unit">ms</span></span>
          <input
            type="number"
            className="handling-input"
            min={0}
            max={500}
            value={handling.das}
            onChange={e => onHandlingChange({ ...handling, das: clamp(e.target.value, 0, 500) })}
          />
        </div>
        <div className="keys-row">
          <span className="keys-action">ARR <span className="keys-unit">ms</span></span>
          <input
            type="number"
            className="handling-input"
            min={0}
            max={200}
            value={handling.arr}
            onChange={e => onHandlingChange({ ...handling, arr: clamp(e.target.value, 0, 200) })}
          />
        </div>
      </div>

      <button
        className="modal-btn cancel keys-reset"
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
