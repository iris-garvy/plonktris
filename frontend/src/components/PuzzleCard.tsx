import type { CSSProperties } from 'react';
import { PIECE_TYPES } from '../tetrisUtils';
import type { Puzzle } from '../api';
import './BrowsePage.css';

const REQ_NAMES = ['TSS', 'TSD', 'TST', 'TETRIS', 'PC', 'ATTACK', 'COMBO'];
const ID_TO_LETTER = ['I', 'O', 'T', 'S', 'Z', 'L', 'J']; // prover ids 0-6

function reqChips(requirements: number[]): string[] {
  const chips = requirements
    .slice(0, 7)
    .map((v, i) => (v > 0 ? `${REQ_NAMES[i]} ${v}` : null))
    .filter((c): c is string => c !== null);
  if (requirements[7]) chips.push('NO HOLD');
  return chips;
}

// tiny 10x20 preview from the 210 occupancy bits (row 0 = hidden spawn row)
function BoardPreview({ board }: { board: number[] }) {
  return (
    <div className="puzzle-preview">
      {Array.from({ length: 20 }, (_, r) =>
        Array.from({ length: 10 }, (_, c) => (
          <div
            key={`${r}-${c}`}
            className={`preview-cell ${board[(r + 1) * 10 + c] ? 'on' : ''}`}
          />
        ))
      )}
    </div>
  );
}

interface PuzzleCardProps {
  puzzle: Puzzle;
  onPlay: (puzzle: Puzzle) => void;
  /** If set, the creator name is a link to their profile. */
  onCreator?: (username: string) => void;
  compact?: boolean;
}

export default function PuzzleCard({ puzzle, onPlay, onCreator, compact }: PuzzleCardProps) {
  return (
    <div className={`puzzle-card ${compact ? 'compact' : ''}`} onDoubleClick={() => onPlay(puzzle)}>
      <BoardPreview board={puzzle.board} />
      <div className="puzzle-info">
        <div className="puzzle-name">{puzzle.name}</div>
        <div className="puzzle-creator">
          by{' '}
          {puzzle.creator && onCreator ? (
            <button className="creator-link" onClick={() => onCreator(puzzle.creator!)}>
              {puzzle.creator}
            </button>
          ) : (
            puzzle.creator ?? 'anonymous'
          )}
        </div>

        <div className="puzzle-queue">
          {puzzle.queue.map((pid, i) => (
            <span
              key={i}
              className="puzzle-queue-chip"
              style={{ '--pc': PIECE_TYPES[pid + 1]?.color ?? '#666' } as CSSProperties}
            >
              {ID_TO_LETTER[pid] ?? '?'}
            </span>
          ))}
        </div>

        <div className="puzzle-reqs">
          {reqChips(puzzle.requirements).map((chip, i) => (
            <span key={i} className="puzzle-req-chip">{chip}</span>
          ))}
        </div>

        <div className="puzzle-footer">
          <span className="puzzle-solves">
            {puzzle.solve_count} solve{puzzle.solve_count === 1 ? '' : 's'}
          </span>
          <button className="puzzle-play-btn" onClick={() => onPlay(puzzle)}>
            play
          </button>
        </div>
      </div>
    </div>
  );
}
