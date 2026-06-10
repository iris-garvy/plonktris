import { PIECE_TYPES, TETROMINOES, NUM_PIECES } from '../tetrisUtils';
import './PieceQueue.css';

const MAX_QUEUE = 8;

function PieceMini({ pieceId, size = 12 }) {
  const shape = TETROMINOES[pieceId]?.[0];
  const color = PIECE_TYPES[pieceId]?.color ?? '#555';
  if (!shape) return <div style={{ width: size * 4, height: size * 4 }} />;

  const filled = new Set(shape.map(([dx, dy]) => `${dx},${dy}`));
  return (
    <div
      className="piece-mini"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(4, ${size}px)`,
        gridTemplateRows:    `repeat(4, ${size}px)`,
        gap: 1,
      }}
    >
      {Array.from({ length: 4 }, (_, dy) =>
        Array.from({ length: 4 }, (_, dx) => {
          const on = filled.has(`${dx},${dy}`);
          return (
            <div
              key={`${dy}-${dx}`}
              className={`mini-cell ${on ? 'on' : 'off'}`}
              style={on ? {
                background: color,
                boxShadow: `0 0 4px ${color}66`,
                border: `1px solid color-mix(in srgb, ${color} 60%, white)`,
              } : {}}
            />
          );
        })
      )}
    </div>
  );
}

export default function PieceQueue({ queue, onQueueChange }) {
  function setPieceAt(idx, value) {
    const next = [...queue];
    next[idx] = value;
    onQueueChange(next);
  }

  function addPiece() {
    if (queue.length >= MAX_QUEUE) return;
    onQueueChange([...queue, 1]); // default to piece 1 (I)
  }

  function removePiece(idx) {
    onQueueChange(queue.filter((_, i) => i !== idx));
  }

  return (
    <div className="piece-queue">
      <div className="panel-label">QUEUE</div>
      <div className="queue-list">
        {queue.map((pieceId, idx) => (
          <div key={idx} className={`queue-item ${idx === 0 ? 'current' : ''}`}>
            <div className="queue-index">{idx === 0 ? '▶' : String(idx).padStart(2, '0')}</div>
            <PieceMini pieceId={pieceId} size={12} />
            <select
              className="piece-selector"
              value={pieceId}
              onChange={e => setPieceAt(idx, Number(e.target.value))}
            >
              {Array.from({ length: NUM_PIECES }, (_, i) => i + 1).map(id => (
                <option key={id} value={id}>{PIECE_TYPES[id].name}</option>
              ))}
            </select>
            <button className="remove-btn" onClick={() => removePiece(idx)} title="Remove">×</button>
          </div>
        ))}
      </div>
      {queue.length < MAX_QUEUE && (
        <button className="add-piece-btn" onClick={addPiece}>+ add piece</button>
      )}
      <div className="queue-hint">Queue defines the pieces available to the prover.</div>
    </div>
  );
}