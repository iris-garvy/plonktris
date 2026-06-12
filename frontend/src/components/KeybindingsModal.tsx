import { useState, useEffect } from 'react';
import {
  BINDING_LABELS, DEFAULT_BINDINGS, DEFAULT_HANDLING, keyLabel, keySig,
  type BindingAction, type Bindings, type Handling,
} from '../keybindings';
import './KeybindingsModal.css';

function clamp(value: string | number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

interface KeybindingsModalProps {
  bindings: Bindings;
  onChange: (next: Bindings) => void;
  handling: Handling;
  onHandlingChange: (next: Handling) => void;
  onClose: () => void;
}

export default function KeybindingsModal({ bindings, onChange, handling, onHandlingChange, onClose }: KeybindingsModalProps) {
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="keys-title">KEYBINDINGS</div>

        <div className="keys-list">
          {(Object.keys(BINDING_LABELS) as BindingAction[]).map(action => (
            <div key={action} className="keys-row">
              <span className="keys-action">{BINDING_LABELS[action]}</span>
              <button
                className={`keys-bind ${listening === action ? 'listening' : ''}`}
                onClick={() => setListening(listening === action ? null : action)}
              >
                {listening === action ? 'press a key…' : keyLabel(bindings[action])}
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

        <div className="modal-actions">
          <button
            className="modal-btn cancel"
            onClick={() => {
              onChange({ ...DEFAULT_BINDINGS });
              onHandlingChange({ ...DEFAULT_HANDLING });
            }}
          >
            reset
          </button>
          <button className="modal-btn submit" onClick={onClose}>done</button>
        </div>
      </div>
    </div>
  );
}
