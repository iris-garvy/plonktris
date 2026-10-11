import type { CSSProperties, MouseEvent } from 'react';
import { Check } from 'lucide-react';
import { PIECE_NAMES } from '../game/engine';
import type { Puzzle } from '../api';
import { PIECE_COLORS } from '../game/colors';
import { linkClick, profilePath, puzzlePath, requirementChips } from '../puzzleInfo';
import './BrowsePage.css';

// tiny 10x20 preview from the 210 occupancy bits (row 0 = hidden spawn row)
function BoardPreview({ board }: { board: number[] }) {
  return (
    <div className="puzzle-preview" aria-hidden="true">
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
  const href = puzzlePath(puzzle.id);
  const play = (e: MouseEvent) => linkClick(e, () => onPlay(puzzle));
  return (
    <div className={`puzzle-card ${compact ? 'compact' : ''}${puzzle.solved_by_me ? ' solved' : ''}`}>
      <a href={href} onClick={play} className="puzzle-preview-link" tabIndex={-1} aria-hidden="true">
        <BoardPreview board={puzzle.board} />
      </a>
      <div className="puzzle-info">
        <a href={href} onClick={play} className="puzzle-name" title={puzzle.name}>
          {puzzle.name}
        </a>
        <div className="puzzle-creator">
          by{' '}
          {puzzle.creator && onCreator ? (
            <a
              className="creator-link"
              href={profilePath(puzzle.creator)}
              onClick={e => linkClick(e, () => onCreator(puzzle.creator!))}
            >
              {puzzle.creator}
            </a>
          ) : (
            puzzle.creator ?? 'anonymous'
          )}
        </div>

        <div className="puzzle-queue">
          {puzzle.queue.map((pid, i) => (
            <span
              key={i}
              className="puzzle-queue-chip"
              style={{ '--pc': PIECE_COLORS[pid + 1] ?? '#666' } as CSSProperties}
            >
              {PIECE_NAMES[pid + 1] ?? '?'}
            </span>
          ))}
        </div>

        <div className="puzzle-reqs">
          {requirementChips(puzzle.requirements).map((chip, i) => (
            <span key={i} className="puzzle-req-chip">{chip}</span>
          ))}
        </div>

        <div className="puzzle-footer">
          <span className="puzzle-solves">
            {puzzle.solve_count} solve{puzzle.solve_count === 1 ? '' : 's'}
          </span>
          <span className="puzzle-solves">
            {puzzle.num_pieces} piece{puzzle.num_pieces === 1 ? '' : 's'}
          </span>
          {puzzle.solved_by_me && (
            <span className="puzzle-solved-mark" title="you've solved this one">
              <Check className="glyph-icon" />solved
            </span>
          )}
          <a href={href} onClick={play} className="puzzle-play-btn">
            {puzzle.solved_by_me ? 'replay' : 'play'}
          </a>
        </div>
      </div>
    </div>
  );
}
