// The card drawn over the board when a run finishes (PuzzlePlayer's `overlay`). Shared by the
// play page and the create page's test run.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import type { FinishResult, PuzzleSpec } from './PuzzlePlayer';
import { formatTime, goalProgress, noFocus, type GoalProgress } from '../puzzleInfo';
import './ResultCard.css';

export function ResultCard({ tone, title, children }: {
  tone: 'success' | 'fail';
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`result-card ${tone}`} role="status" aria-live="polite">
      <div className="result-title">{title}</div>
      {children}
    </div>
  );
}

/** Buttons on the card never take focus, so the game's keys (restart, undo…) keep working. */
export function CardButton({ variant = 'ghost', className = '', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'link' }) {
  return (
    <button
      type="button"
      className={`card-btn ${variant} ${className}`}
      onMouseDown={noFocus}
      {...props}
    />
  );
}

export function RunStats({ result }: { result: FinishResult }) {
  return (
    <dl className="run-stats">
      <div><dt>time</dt><dd>{formatTime(result.timeMs)}</dd></div>
      <div><dt>pieces</dt><dd>{result.pieces}</dd></div>
      <div><dt>keys</dt><dd>{result.keys}</dd></div>
    </dl>
  );
}

export function GoalList({ goals }: { goals: GoalProgress[] }) {
  return (
    <ul className="goal-list">
      {goals.map(g => (
        <li key={g.name} className={g.met ? 'met' : 'missing'}>
          {g.met ? <Check className="glyph-icon" /> : <X className="glyph-icon" />}
          <span className="goal-name">{g.name}</span>
          <span className="goal-count">{g.have}/{g.need}</span>
        </li>
      ))}
    </ul>
  );
}

/** "requirements not met" / "topped out", with undo + retry. */
export function FailureCard({ result, spec, onUndo, onRetry, children }: {
  result: FinishResult;
  spec: PuzzleSpec;
  onUndo: () => void;
  onRetry: () => void;
  children?: ReactNode;
}) {
  const toppedOut = result.pieces < spec.queue.length;
  return (
    <ResultCard tone="fail" title={toppedOut ? 'topped out' : 'requirements not met'}>
      {toppedOut ? (
        <p className="result-note">the next piece had nowhere to spawn.</p>
      ) : (
        <GoalList goals={goalProgress(spec.requirements, result.ledger)} />
      )}
      <div className="result-actions">
        <CardButton onClick={onUndo} disabled={result.pieces === 0}>undo last piece</CardButton>
        <CardButton variant="primary" onClick={onRetry}>retry</CardButton>
      </div>
      {children}
    </ResultCard>
  );
}
