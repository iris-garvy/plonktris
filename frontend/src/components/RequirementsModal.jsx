import RequirementsEditor from './RequirementsEditor';
import './RequirementsModal.css';

export default function RequirementsModal({ requirements, onChange, onSubmit, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <RequirementsEditor
          requirements={requirements}
          onRequirementsChange={onChange}
        />
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={onCancel}>cancel</button>
          <button className="modal-btn submit" onClick={onSubmit}>▶ solve</button>
        </div>
      </div>
    </div>
  );
}
