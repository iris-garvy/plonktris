import type { Requirements } from '../game/engine';
import { noFocus } from '../puzzleInfo';
import './RequirementsEditor.css';

const REQ_FIELDS = [
  { label: 'TSS',     desc: 't-spin singles',  idx: 0 },
  { label: 'TSD',     desc: 't-spin doubles',  idx: 1 },
  { label: 'TST',     desc: 't-spin triples',  idx: 2 },
  { label: 'TETRIS',  desc: 'tetrises',        idx: 3 },
  { label: 'PC',      desc: 'perfect clears',  idx: 4 },
  { label: 'ATTACK',  desc: 'lines sent',      idx: 5 },
  { label: 'COMBO',   desc: 'max combo',       idx: 6 },
];

interface RequirementsEditorProps {
  requirements: Requirements;
  onRequirementsChange: (next: Requirements) => void;
  /** highlight the counted goals (none set yet) */
  invalid?: boolean;
}

export default function RequirementsEditor({ requirements, onRequirementsChange, invalid }: RequirementsEditorProps) {
  function setAt(idx: number, value: number | string) {
    const next = [...requirements];
    next[idx] = Math.max(0, Math.min(255, Math.floor(Number(value)) || 0));
    onRequirementsChange(next);
  }

  function toggleNoHold() {
    const next = [...requirements];
    next[7] = next[7] ? 0 : 1;
    onRequirementsChange(next);
  }

  return (
    <div className={`req-editor${invalid ? ' invalid' : ''}`}>
      <div className="req-list">
        {REQ_FIELDS.map(({ label, desc, idx }) => (
          <div key={idx} className={`req-row${requirements[idx] > 0 ? ' set' : ''}`}>
            <span className="req-info">
              <span className="req-label">{label}</span>
              <span className="req-desc">{desc}</span>
            </span>
            <div className="req-num-wrap">
              <button
                type="button"
                className="req-step"
                onMouseDown={noFocus}
                onClick={() => setAt(idx, requirements[idx] - 1)}
                disabled={requirements[idx] <= 0}
                aria-label={`fewer ${desc}`}
              >−</button>
              <input
                type="number"
                min={0}
                max={255}
                value={requirements[idx]}
                onChange={e => setAt(idx, e.target.value)}
                onFocus={e => e.currentTarget.select()}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="req-num"
                aria-label={desc}
              />
              <button
                type="button"
                className="req-step"
                onMouseDown={noFocus}
                onClick={() => setAt(idx, requirements[idx] + 1)}
                aria-label={`more ${desc}`}
              >+</button>
            </div>
          </div>
        ))}
        <div className={`req-row${requirements[7] ? ' set' : ''}`}>
          <span className="req-info">
            <span className="req-label">NO HOLD</span>
            <span className="req-desc">hold disabled</span>
          </span>
          <button
            type="button"
            className={`req-toggle ${requirements[7] ? 'on' : 'off'}`}
            onMouseDown={noFocus}
            onClick={toggleNoHold}
            aria-pressed={!!requirements[7]}
          >
            {requirements[7] ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    </div>
  );
}
