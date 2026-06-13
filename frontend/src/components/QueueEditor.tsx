import './QueueEditor.css';
import { PIECE_TYPES } from '../tetrisUtils';
import PieceMini from './PieceMini';
import type { CSSProperties, ChangeEvent, KeyboardEvent } from 'react';

const LETTER_TO_ID: Record<string, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, L: 6, J: 7 };
const ID_TO_LETTER: Record<number, string> = { 1: 'I', 2: 'O', 3: 'T', 4: 'S', 5: 'Z', 6: 'L', 7: 'J' };
const MAX_QUEUE = 21;

export function queueToText(queue: number[]): string {
  return queue.map(id => ID_TO_LETTER[id] ?? '?').join('');
}
export function textToQueue(text: string): number[] {
  return text.toUpperCase().split('')
    .filter(c => LETTER_TO_ID[c])
    .map(c => LETTER_TO_ID[c])
    .slice(0, MAX_QUEUE);
}

interface QueueEditorProps {
  queue: number[];
  onQueueChange?: (queue: number[]) => void;
  nextIdx?: number;
}

export default function QueueEditor({ queue, onQueueChange, nextIdx = 0 }: QueueEditorProps) {
  const editable = !!onQueueChange;

  // the next 6 unconsumed queue pieces (the piece in play is on the board)
  const displaySlots = Array.from({ length: 6 }, (_, i) => ({
    pieceId: queue[nextIdx + i] ?? null,
  }));

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
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
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          // Enter hands control back to the board (key handling is global,
          // it only ignores keys while an input is focused)
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        }}
      />

      {/* Queue column: 6 squares, overflow chips fused below */}
      <div className="queue-column">
        {displaySlots.map(({ pieceId }, i) => (
          <div
            key={i}
            className={`queue-box ${pieceId == null ? 'empty' : ''}`}
          >
            {pieceId != null && <PieceMini pieceId={pieceId} size={16} />}
          </div>
        ))}

        {/* overflow: pieces waiting to enter the visible queue */}
        {queue.length > nextIdx + 6 && (
          <div className="queue-overflow">
            {queue.slice(nextIdx + 6).map((pid, i) => (
              <span
                key={i}
                className="queue-chip"
                style={{ '--pc': PIECE_TYPES[pid]?.color ?? '#666' } as CSSProperties}
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
