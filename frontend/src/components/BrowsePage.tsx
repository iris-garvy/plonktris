import { useState, useEffect } from 'react';
import { api, type Puzzle } from '../api';
import { PIECE_TYPES } from '../tetrisUtils';
import type { CSSProperties } from 'react';
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
}

function PuzzleCard({ puzzle, onPlay }: PuzzleCardProps) {
  return (
    <div className="puzzle-card" onDoubleClick={() => onPlay(puzzle)}>
      <BoardPreview board={puzzle.board} />
      <div className="puzzle-info">
        <div className="puzzle-name">{puzzle.name}</div>
        <div className="puzzle-creator">by {puzzle.creator ?? 'anonymous'}</div>

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
            ▶ play
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BrowsePage({ onPlay }: { onPlay: (puzzle: Puzzle) => void }) {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listPuzzles()
      .then(({ puzzles }) => { if (!cancelled) setPuzzles(puzzles); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="browse-status">
        <div className="browse-error">couldn't load puzzles: {error}</div>
        <div className="browse-hint">is the server running on :3000?</div>
      </div>
    );
  }

  if (puzzles == null) {
    return <div className="browse-status">loading puzzles…</div>;
  }

  if (puzzles.length === 0) {
    return (
      <div className="browse-status">
        no puzzles yet — be the first to publish one!
      </div>
    );
  }

  return (
    <div className="browse-grid">
      {puzzles.map(p => (
        <PuzzleCard key={p.id} puzzle={p} onPlay={onPlay} />
      ))}
    </div>
  );
}
