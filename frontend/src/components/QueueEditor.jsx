import './QueueEditor.css';
import { PIECE_TYPES } from '../tetrisUtils';
import PieceMini from './PieceMini';

const LETTER_TO_ID = { I:1, O:2, T:3, S:4, Z:5, L:6, J:7 };
const ID_TO_LETTER = { 1:'I', 2:'O', 3:'T', 4:'S', 5:'Z', 6:'L', 7:'J' };
const MAX_QUEUE = 25;

export function queueToText(queue) {
  return queue.map(id => ID_TO_LETTER[id] ?? '?').join('');
}
export function textToQueue(text) {
  return text.toUpperCase().split('')
    .filter(c => LETTER_TO_ID[c])
    .map(c => LETTER_TO_ID[c])
    .slice(0, MAX_QUEUE);
}

// Board grid height (21 rows × 26px) = 546px
// Toolbar height = 36px, gap = 8px  → total board height = 590px
// 6 boxes × BOX_H + 5 × GAP + label + chips must ≈ 590px

export default function QueueEditor({ queue, onQueueChange, currentIdx = 0 }) {
  const editable = !!onQueueChange;

  // The 6 displayed slots: index currentIdx through currentIdx+5
  const displaySlots = Array.from({ length: 6 }, (_, i) => {
    const qi = currentIdx + i;
    return { pieceId: queue[qi] ?? null, isCurrent: i === 0 };
  });

  function handleChange(e) {
    onQueueChange?.(textToQueue(e.target.value));
  }

  return (
    <div className="queue-editor">
      <input
        className={`queue-text-input ${editable ? '' : 'readonly'}`}
        type="text"
        value={queueToText(queue)}
        onChange={handleChange}
        placeholder="IOTSZLJ…"
        spellCheck={false}
        autoComplete="off"
        readOnly={!editable}
        tabIndex={editable ? 0 : -1}
      />

      {/* Queue column: 6 squares, overflow chips fused below */}
      <div className="queue-column">
        {displaySlots.map(({ pieceId, isCurrent }, i) => (
          <div
            key={i}
            className={`queue-box ${isCurrent ? 'current' : ''} ${pieceId == null ? 'empty' : ''}`}
          >
            {pieceId != null && <PieceMini pieceId={pieceId} size={16} />}
          </div>
        ))}

        {/* overflow: pieces waiting to enter the visible queue */}
        {queue.length > currentIdx + 6 && (
          <div className="queue-overflow">
            {queue.slice(currentIdx + 6).map((pid, i) => (
              <span
                key={i}
                className="queue-chip"
                style={{ '--pc': PIECE_TYPES[pid]?.color ?? '#666' }}
              >
                {ID_TO_LETTER[pid] ?? '?'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
