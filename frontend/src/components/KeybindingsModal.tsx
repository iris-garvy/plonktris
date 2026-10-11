import { useEffect } from 'react';
import KeybindingsEditor from './KeybindingsEditor';
import { type Bindings, type Handling } from '../keybindings';
import './KeybindingsModal.css';

interface KeybindingsModalProps {
  bindings: Bindings;
  onChange: (next: Bindings) => void;
  handling: Handling;
  onHandlingChange: (next: Handling) => void;
  onClose: () => void;
}

export default function KeybindingsModal({ bindings, onChange, handling, onHandlingChange, onClose }: KeybindingsModalProps) {
  // Escape closes (while rebinding, the editor swallows Escape to cancel the rebind instead)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // .modal-overlay also tells the game's input controller to ignore keys in here
    <div className="modal-overlay settings-overlay" onClick={onClose}>
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="controls settings"
        onClick={e => e.stopPropagation()}
      >
        <KeybindingsEditor
          bindings={bindings}
          onChange={onChange}
          handling={handling}
          onHandlingChange={onHandlingChange}
        />
        <button type="button" className="settings-done" onClick={onClose}>done</button>
      </div>
    </div>
  );
}
