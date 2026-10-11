import './QueueEditor.css';
import PieceMini from './PieceMini';
import { PIECE_NAMES, PIECE_IDS } from '../game/engine';
import { PIECE_COLORS } from '../game/colors';
import { MAX_QUEUE, noFocus } from '../puzzleInfo';
import type { CSSProperties, ChangeEvent, KeyboardEvent } from 'react';

const LETTER_TO_ID: Record<string, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, L: 6, J: 7 };

export function queueToText(queue: number[]): string {
  return queue.map(id => PIECE_NAMES[id] ?? '?').join('');
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
  /** 'panel': fits a side panel — the queue as a wrapped chip strip instead of a 6-box column */
  variant?: 'column' | 'panel';
}

export default function QueueEditor({ queue, onQueueChange, nextIdx = 0, variant = 'column' }: QueueEditorProps) {
  const editable = !!onQueueChange;
  const full = queue.length >= MAX_QUEUE;

  const displaySlots = Array.from({ length: 6 }, (_, i) => ({
    pieceId: queue[nextIdx + i] ?? null,
  }));

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onQueueChange?.(textToQueue(e.target.value));
  }

  return (
    <div className={`queue-editor ${variant}`}>
      <div className="queue-head">
        <span className="panel-label queue-label">QUEUE</span>
        <span className={`queue-count${full ? ' full' : ''}`}>{queue.length}/{MAX_QUEUE}</span>
      </div>
      <input
        className={`queue-text-input ${editable ? '' : 'readonly'}`}
        type="text"
        value={queueToText(queue)}
        onChange={handleChange}
        placeholder="type IOTSZLJ…"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        readOnly={!editable}
        tabIndex={editable ? 0 : -1}
        aria-label="piece queue"
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          // Enter hands control back to the board (the board ignores keys while a field is focused)
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        }}
      />

      {editable && (
        <div className="queue-pick" aria-label="add a piece">
          {PIECE_IDS.map(id => (
            <button
              key={id}
              type="button"
              className="queue-pick-btn"
              style={{ '--pc': PIECE_COLORS[id] } as CSSProperties}
              onMouseDown={noFocus}
              onClick={() => onQueueChange?.([...queue, id].slice(0, MAX_QUEUE))}
              disabled={full}
              title={`add ${PIECE_NAMES[id]}`}
            >
              {PIECE_NAMES[id]}
            </button>
          ))}
          <button
            type="button"
            className="queue-pick-btn erase"
            onMouseDown={noFocus}
            onClick={() => onQueueChange?.(queue.slice(0, -1))}
            disabled={queue.length === 0}
            title="remove the last piece"
            aria-label="remove the last piece"
          >
            ⌫
          </button>
        </div>
      )}

      {variant === 'panel' ? (
        <div className="queue-strip" aria-hidden="true">
          {queue.length === 0 && <span className="queue-strip-empty">no pieces yet</span>}
          {queue.map((pid, i) => (
            <span
              key={i}
              className="queue-chip"
              style={{ '--pc': PIECE_COLORS[pid] ?? '#666' } as CSSProperties}
            >
              {PIECE_NAMES[pid] ?? '?'}
            </span>
          ))}
        </div>
      ) : (
      <div className="queue-column">
        {displaySlots.map(({ pieceId }, i) => (
          <div
            key={i}
            className={`queue-box ${pieceId == null ? 'empty' : ''}`}
          >
            {pieceId != null && <PieceMini pieceId={pieceId} size={16} />}
          </div>
        ))}

        {/* overflow */}
        {queue.length > nextIdx + 6 && (
          <div className="queue-overflow">
            {queue.slice(nextIdx + 6).map((pid, i) => (
              <span
                key={i}
                className="queue-chip"
                style={{ '--pc': PIECE_COLORS[pid] ?? '#666' } as CSSProperties}
              >
                {PIECE_NAMES[pid] ?? '?'}
              </span>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
