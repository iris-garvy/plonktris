import type { Requirements } from '../tetrisLedger';
import './RequirementsEditor.css';

const REQ_FIELDS = [
  { label: 'TSS',       desc: 'T-Spin Singles',  idx: 0, boolean: false },
  { label: 'TSD',       desc: 'T-Spin Doubles',  idx: 1, boolean: false },
  { label: 'TST',       desc: 'T-Spin Triples',  idx: 2, boolean: false },
  { label: 'Tetris',    desc: 'Tetrises',         idx: 3, boolean: false },
  { label: 'PC',        desc: 'Perfect Clears',   idx: 4, boolean: false },
  { label: 'Attack',    desc: 'Lines sent',       idx: 5, boolean: false },
  { label: 'Combo',     desc: 'Max combo',        idx: 6, boolean: false },
  { label: 'No Hold',   desc: 'Disallow hold',    idx: 7, boolean: true  },
];

interface RequirementsEditorProps {
  requirements: Requirements;
  onRequirementsChange: (next: Requirements) => void;
  locked?: boolean;
}

export default function RequirementsEditor({ requirements, onRequirementsChange, locked = false }: RequirementsEditorProps) {
  function setAt(idx: number, value: number | string) {
    if (locked) return;
    const next = [...requirements];
    next[idx] = Math.max(0, Math.min(255, Number(value) || 0));
    onRequirementsChange(next);
  }

  function toggleBool(idx: number) {
    if (locked) return;
    const next = [...requirements];
    next[idx] = next[idx] ? 0 : 1;
    onRequirementsChange(next);
  }

  return (
    <div className="req-editor">
      <div className="panel-label">CONDITIONS</div>
      <div className="req-list">
        {REQ_FIELDS.map(({ label, idx, boolean }) => (
          <div key={idx} className="req-row">
            <span className="req-label">{label}</span>
            {boolean ? (
              <button
                className={`req-toggle ${requirements[idx] ? 'on' : 'off'}`}
                onClick={() => toggleBool(idx)}
                disabled={locked}
              >
                {requirements[idx] ? 'YES' : 'NO'}
              </button>
            ) : (
              <div className="req-num-wrap">
                <button
                  className="req-step"
                  onClick={() => setAt(idx, requirements[idx] - 1)}
                  style={locked ? { visibility: 'hidden' } : undefined}
                >−</button>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={requirements[idx]}
                  onChange={e => setAt(idx, e.target.value)}
                  className="req-num"
                  readOnly={locked}
                  tabIndex={locked ? -1 : 0}
                />
                <button
                  className="req-step"
                  onClick={() => setAt(idx, requirements[idx] + 1)}
                  style={locked ? { visibility: 'hidden' } : undefined}
                >+</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
