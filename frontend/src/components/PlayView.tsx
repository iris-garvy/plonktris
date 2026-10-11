// /p/:id — play a published puzzle. App keys this component by puzzle id, so all run state
// (result, submission) is per puzzle and can't leak into the next one.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Star } from 'lucide-react';
import PuzzlePlayer, { type FinishResult, type PuzzlePlayerHandle } from './PuzzlePlayer';
import { CardButton, FailureCard, ResultCard, RunStats } from './ResultCard';
import { api, ApiError, errorMessage, type Puzzle, type SolveResult, type User } from '../api';
import {
  linkClick, markSessionSolved, noFocus, profilePath, sessionSolved, specFromPuzzle,
} from '../puzzleInfo';
import { useTypingFocus } from '../useTypingFocus';
import type { Bindings, Handling } from '../keybindings';
import './PlayView.css';

type Submit =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; res: SolveResult }
  | { kind: 'error'; message: string };

interface PlayViewProps {
  puzzle: Puzzle;
  user: User | null;
  bindings: Bindings;
  handling: Handling;
  /** a modal is open — the board ignores keys */
  inputBlocked: boolean;
  /** the viewer published this puzzle a moment ago — show the share banner */
  justPublished: boolean;
  onLogin: () => void;
  onAuthExpired: () => void;
  onSolved: (id: string, res: SolveResult) => void;
  onOpenPuzzle: (puzzle: Puzzle) => void;
  onNavigate: (path: string) => void;
}

export default function PlayView({
  puzzle, user, bindings, handling, inputBlocked, justPublished,
  onLogin, onAuthExpired, onSolved, onOpenPuzzle, onNavigate,
}: PlayViewProps) {
  // computed once: App re-renders us with refreshed puzzle objects (solve counts etc.), which
  // must not hand PuzzlePlayer a "new" puzzle and reset the run
  const [spec] = useState(() => specFromPuzzle(puzzle));
  const playerRef = useRef<PuzzlePlayerHandle>(null);
  const typing = useTypingFocus();

  const [result, setResult] = useState<FinishResult | null>(null);
  const resultRef = useRef<FinishResult | null>(null);
  const [submit, setSubmit] = useState<Submit>({ kind: 'idle' });
  // the run we've already sent (or are sending) — guards against double submits
  const submittedRef = useRef<FinishResult | null>(null);

  const [findingNext, setFindingNext] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isCreator = !!user && !!puzzle.creator
    && user.username.toLowerCase() === puzzle.creator.toLowerCase();

  // count the open for difficulty stats (logged-in only; idempotent server-side)
  const userId = user?.id;
  useEffect(() => {
    if (userId) api.recordAttempt(puzzle.id).catch(() => {});
  }, [puzzle.id, userId]);

  function handleFinish(r: FinishResult) {
    resultRef.current = r;
    setResult(r);
    setSubmit({ kind: 'idle' });
    setNextError(null);
    if (r.success) markSessionSolved(puzzle.id);
  }

  function handleReset() {
    resultRef.current = null;
    setResult(null);
    setSubmit({ kind: 'idle' });
  }

  function retry() { playerRef.current?.restart(); handleReset(); }
  function undo()  { playerRef.current?.undo(); handleReset(); }

  function sendSolve(r: FinishResult) {
    submittedRef.current = r;
    setSubmit({ kind: 'sending' });
    api.solvePuzzle(puzzle.id, r.solution)
      .then(res => {
        onSolved(puzzle.id, res);
        if (resultRef.current === r) setSubmit({ kind: 'done', res });
      })
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) {
          // stale token: drop the session; logging back in re-submits this run
          submittedRef.current = null;
          onAuthExpired();
          if (resultRef.current === r) setSubmit({ kind: 'idle' });
          return;
        }
        if (resultRef.current === r) setSubmit({ kind: 'error', message: errorMessage(err) });
      });
  }

  // logged in (now, or after "log in to save") + a successful run not yet sent → record it
  useEffect(() => {
    if (!result?.success || !user || submittedRef.current === result) return;
    sendSolve(result);
    // sendSolve is recreated every render; result + user are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, user]);

  async function goNext() {
    setFindingNext(true);
    setNextError(null);
    try {
      const { puzzles } = await api.listPuzzles({ sort: 'solves', limit: 60 });
      const skip = sessionSolved();
      const me = user?.username.toLowerCase();
      const others = puzzles.filter(p => p.id !== puzzle.id);
      const fresh = others.filter(p =>
        !p.solved_by_me && !skip.has(p.id) && (me == null || p.creator?.toLowerCase() !== me));
      const pick = fresh[0] ?? others[Math.floor(Math.random() * others.length)];
      if (!mountedRef.current) return;   // the player already went somewhere else
      if (pick) onOpenPuzzle(pick);
      else onNavigate('/');
    } catch (err) {
      if (!mountedRef.current) return;
      setNextError(errorMessage(err));
      setFindingNext(false);
    }
  }

  let overlay = null;
  if (result?.success) {
    overlay = (
      <ResultCard tone="success" title="solved!">
        <RunStats result={result} />
        <SaveStatus
          submit={submit}
          loggedIn={!!user}
          isCreator={isCreator}
          onLogin={onLogin}
          onRetry={() => sendSolve(result)}
        />
        {nextError && <p className="result-note error">{nextError}</p>}
        <div className="result-actions">
          <CardButton variant="primary" onClick={goNext} disabled={findingNext}>
            {findingNext ? 'finding one…' : 'next puzzle'}
          </CardButton>
        </div>
        <div className="result-actions">
          <CardButton onClick={retry}>retry</CardButton>
          <CardButton onClick={() => onNavigate('/')}>browse</CardButton>
        </div>
      </ResultCard>
    );
  } else if (result) {
    overlay = <FailureCard result={result} spec={spec} onUndo={undo} onRetry={retry} />;
  }

  return (
    <div className="play-view">
      <div className="play-head">
        <div className="play-head-top">
          <h1 className="play-title" title={puzzle.name}>{puzzle.name}</h1>
          {puzzle.solved_by_me && (
            <span className="solved-badge" title="you've solved this one">
              <Check className="glyph-icon" />solved
            </span>
          )}
        </div>
        <div className="play-meta">
          <span>
            by{' '}
            {puzzle.creator ? (
              <a
                className="creator-link"
                href={profilePath(puzzle.creator)}
                onClick={e => linkClick(e, () => onNavigate(profilePath(puzzle.creator!)))}
              >
                {puzzle.creator}
              </a>
            ) : 'anonymous'}
          </span>
          <span className="play-meta-sep">·</span>
          <span>{puzzle.solve_count} solve{puzzle.solve_count === 1 ? '' : 's'}</span>
          <span className="play-meta-sep">·</span>
          <span>{puzzle.num_pieces} piece{puzzle.num_pieces === 1 ? '' : 's'}</span>
        </div>
      </div>

      {justPublished && <PublishedBanner id={puzzle.id} />}

      <div className="play-board">
        <PuzzlePlayer
          ref={playerRef}
          puzzle={spec}
          bindings={bindings}
          handling={handling}
          onFinish={handleFinish}
          onReset={handleReset}
          overlay={overlay}
          disabled={inputBlocked || typing}
        />
      </div>
    </div>
  );
}

function SaveStatus({ submit, loggedIn, isCreator, onLogin, onRetry }: {
  submit: Submit;
  loggedIn: boolean;
  isCreator: boolean;
  onLogin: () => void;
  onRetry: () => void;
}) {
  if (submit.kind === 'done') {
    const { res } = submit;
    if (res.new_solve) {
      return (
        <div>
          <p className="result-note ok"><Check className="glyph-icon glyph-lead" />recorded</p>
          {res.first_solve && (
            <p className="result-note star">
              <Star className="glyph-icon glyph-lead" fill="currentColor" />first solve!
            </p>
          )}
        </div>
      );
    }
    return (
      <p className="result-note ok">
        <Check className="glyph-icon glyph-lead" />
        {isCreator ? "verified — it's your puzzle, so it doesn't count" : 'verified — already in your solves'}
      </p>
    );
  }
  if (submit.kind === 'error') {
    return (
      <div>
        <p className="result-note error">couldn't save your solve: {submit.message}</p>
        <CardButton variant="link" onClick={onRetry}>try again</CardButton>
      </div>
    );
  }
  if (!loggedIn) {
    return <CardButton variant="link" onClick={onLogin}>log in to save this solve</CardButton>;
  }
  return <p className="result-note">recording…</p>;
}

function PublishedBanner({ id }: { id: string }) {
  const url = `${window.location.origin}/p/${encodeURIComponent(id)}`;
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(url)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }

  return (
    <div className="publish-banner">
      <span className="publish-banner-title">published!</span>
      <span className="publish-banner-text">share it:</span>
      <code className="publish-banner-url">{url}</code>
      <button type="button" className="publish-banner-copy" onMouseDown={noFocus} onClick={copy}>
        {copied ? <><Check className="glyph-icon glyph-lead" />copied</> : <><Copy className="glyph-icon glyph-lead" />copy link</>}
      </button>
    </div>
  );
}
