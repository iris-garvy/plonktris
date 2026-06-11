import { useState, useEffect } from 'react';
import { BINDING_LABELS, DEFAULT_BINDINGS, DEFAULT_HANDLING, keyLabel, keySig } from '../keybindings';
import './KeybindingsModal.css';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export default function KeybindingsModal({ bindings, onChange, handling, onHandlingChange, onClose }) {
  const [listening, setListening] = useState(null); // action awaiting a keypress

  useEffect(() => {
    if (!listening) return;
    function onKey(e) {
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
      const conflict = Object.keys(next).find(a => next[a] === key && a !== listening);
      if (conflict) next[conflict] = next[listening];
      next[listening] = key;
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
          {Object.keys(BINDING_LABELS).map(action => (
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
