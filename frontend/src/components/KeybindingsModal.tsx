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
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <KeybindingsEditor
          bindings={bindings}
          onChange={onChange}
          handling={handling}
          onHandlingChange={onHandlingChange}
        />
        <div className="modal-actions">
          <button className="modal-btn submit" onClick={onClose}>done</button>
        </div>
      </div>
    </div>
  );
}
