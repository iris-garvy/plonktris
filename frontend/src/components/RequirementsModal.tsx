import RequirementsEditor from './RequirementsEditor';
import { GlassIcon } from './icons';
import type { Requirements } from '../tetrisLedger';
import './RequirementsModal.css';

interface RequirementsModalProps {
  requirements: Requirements;
  onChange: (next: Requirements) => void;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function RequirementsModal({ requirements, onChange, name, onNameChange, onSubmit, onCancel }: RequirementsModalProps) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <input
          className="puzzle-name-input"
          type="text"
          placeholder="puzzle name"
          value={name}
          onChange={e => onNameChange(e.target.value)}
          maxLength={64}
          spellCheck={false}
        />
        <RequirementsEditor
          requirements={requirements}
          onRequirementsChange={onChange}
        />
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={onCancel}>cancel</button>
          <button className="modal-btn submit" onClick={onSubmit}><GlassIcon className="btn-icon glass-nudge" />prove</button>
        </div>
      </div>
    </div>
  );
}
