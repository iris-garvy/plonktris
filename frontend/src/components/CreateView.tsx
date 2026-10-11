// /create — build a puzzle (board, queue, goals, name), test it, publish it.
//
// One screen: the editor and the goals panel side by side; "test it" swaps the editor for a
// PuzzlePlayer running the puzzle exactly as it'll be published, and solving it unlocks
// publish. The draft lives in localStorage so a refresh or a login never loses work.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play } from 'lucide-react';
import BoardEditor from './BoardEditor';
import PuzzlePlayer, { type FinishResult, type PuzzlePlayerHandle, type PuzzleSpec } from './PuzzlePlayer';
import QueueEditor from './QueueEditor';
import RequirementsEditor from './RequirementsEditor';
import { CardButton, FailureCard, ResultCard, RunStats } from './ResultCard';
import { api, ApiError, errorMessage, type User } from '../api';
import {
  COLS, EMPTY, ROWS, boardToBits, clearLines, cloneBoard, emptyBoard, fits, queueToApi, spawnCol,
  type Board,
} from '../game/engine';
import { MAX_NAME, MAX_QUEUE, hasCountedGoal, noFocus } from '../puzzleInfo';
import { useTypingFocus } from '../useTypingFocus';
import type { Bindings, Handling } from '../keybindings';
import './CreateView.css';

// ---------------------------------------------------------------------------
// draft persistence
// ---------------------------------------------------------------------------

const DRAFT_KEY = 'plonktris-draft';
const DEFAULT_QUEUE = [1, 2, 3, 4, 5, 6, 7];

interface Draft {
  board: Board;
  /** client piece ids 1-7 */
  queue: number[];
  /** 8-byte API format */
  requirements: number[];
  name: string;
}

function newDraft(): Draft {
  return { board: emptyBoard(), queue: [...DEFAULT_QUEUE], requirements: [0, 0, 0, 0, 0, 0, 0, 0], name: '' };
}

/** Whatever is in storage → a valid draft (bad fields fall back to the defaults). */
function sanitizeDraft(raw: unknown): Draft {
  const d = newDraft();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;

  if (Array.isArray(r.board) && r.board.length === ROWS
      && r.board.every(row => Array.isArray(row) && row.length === COLS)) {
    const board = (r.board as unknown[][]).map(row =>
      row.map(c => (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 8 ? c : EMPTY)));
    board[0] = new Array<number>(COLS).fill(EMPTY);   // nothing in the spawn row
    d.board = clearLines(board).board;                // no full rows
  }
  if (Array.isArray(r.queue)) {
    d.queue = r.queue
      .filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= 7)
      .slice(0, MAX_QUEUE);
  }
  if (Array.isArray(r.requirements) && r.requirements.length === 8) {
    d.requirements = r.requirements.map((v, i) => {
      const n = Math.floor(Number(v)) || 0;
      return i === 7 ? (n ? 1 : 0) : Math.max(0, Math.min(255, n));
    });
  }
  if (typeof r.name === 'string') d.name = r.name.slice(0, MAX_NAME);
  return d;
}

function loadDraft(): Draft {
  try {
    return sanitizeDraft(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'));
  } catch {
    return newDraft();
  }
}

function saveDraft(d: Draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode etc */ }
}

function clearStoredDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

function isBlankDraft(d: Draft): boolean {
  return d.name === ''
    && d.board.every(row => row.every(c => c === EMPTY))
    && d.queue.length === DEFAULT_QUEUE.length && d.queue.every((id, i) => id === DEFAULT_QUEUE[i])
    && d.requirements.every(v => v === 0);
}

/** Why the draft can't be tested yet (empty = good to go). */
function draftProblems(d: Draft): string[] {
  const out: string[] = [];
  if (d.queue.length === 0) out.push('add at least one piece to the queue');
  else if (!fits(d.board, d.queue[0], 0, 0, spawnCol(d.queue[0]))) {
    out.push('the first piece has no room to spawn — clear the top of the board');
  }
  if (!hasCountedGoal(d.requirements)) out.push("set at least one goal (no hold on its own doesn't count)");
  return out;
}

function publishError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'your session expired — log in again to publish';
    if (err.status === 409) {
      return 'this exact puzzle (same board, queue and goals) is already published. change something and try again.';
    }
    if (err.status === 400 && /doesn.t solve/i.test(err.message)) {
      const reason = err.message.split(': ').slice(1).join(': ');
      return `the server couldn't verify your solve${reason ? ` (${reason})` : ''}. try solving it again.`;
    }
  }
  return errorMessage(err);
}

// ---------------------------------------------------------------------------

export interface PublishedPuzzle {
  id: string;
  name: string;
  creator: string;
  spec: PuzzleSpec;
}

interface CreateViewProps {
  user: User | null;
  bindings: Bindings;
  handling: Handling;
  /** a modal is open — the board ignores keys */
  inputBlocked: boolean;
  /** runs `then` once the viewer is logged in (opening the login modal first if needed) */
  requireAuth: (then: (user: User) => void, reason: string) => void;
  onAuthExpired: () => void;
  onPublished: (puzzle: PublishedPuzzle) => void;
}

type PublishState =
  | { kind: 'idle' }
  | { kind: 'publishing' }
  | { kind: 'error'; message: string };

export default function CreateView({
  user, bindings, handling, inputBlocked, requireAuth, onAuthExpired, onPublished,
}: CreateViewProps) {
  const [draft, setDraft] = useState<Draft>(loadDraft);
  useEffect(() => { saveDraft(draft); }, [draft]);

  const typing = useTypingFocus();
  const [triedTest, setTriedTest] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // test run: the exact puzzle being tested (frozen when "test it" is pressed)
  const [testSpec, setTestSpec] = useState<PuzzleSpec | null>(null);
  const [result, setResult] = useState<FinishResult | null>(null);
  const resultRef = useRef<FinishResult | null>(null);
  const [publish, setPublish] = useState<PublishState>({ kind: 'idle' });
  const publishingRef = useRef(false);
  const playerRef = useRef<PuzzlePlayerHandle>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // the "new puzzle" confirm times out
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const problems = draftProblems(draft);
  const publishing = publish.kind === 'publishing';

  function patch(p: Partial<Draft>) {
    setDraft(d => ({ ...d, ...p }));
  }

  function startTest() {
    if (problems.length > 0) { setTriedTest(true); return; }
    setTriedTest(false);
    setTestSpec({
      board: cloneBoard(draft.board),
      queue: [...draft.queue],
      requirements: [...draft.requirements],
    });
    resultRef.current = null;
    setResult(null);
    setPublish({ kind: 'idle' });
  }

  function backToEditing() {
    resultRef.current = null;
    setResult(null);
    setTestSpec(null);
    setPublish({ kind: 'idle' });
  }

  function clearDraft() {
    if (!confirmClear) { setConfirmClear(true); return; }
    setConfirmClear(false);
    setTriedTest(false);
    setDraft(newDraft());
  }

  function handleFinish(r: FinishResult) {
    resultRef.current = r;
    setResult(r);
    setPublish({ kind: 'idle' });
  }

  function handleReset() {
    resultRef.current = null;
    setResult(null);
    setPublish({ kind: 'idle' });
  }

  function retry() { playerRef.current?.restart(); handleReset(); }
  function undo()  { playerRef.current?.undo(); handleReset(); }

  function handlePublish() {
    if (!result?.success || !testSpec || publishingRef.current) return;
    const name = draft.name.trim();
    if (!name) {
      setPublish({ kind: 'error', message: 'give your puzzle a name first' });
      nameRef.current?.focus();
      return;
    }
    const r = result, spec = testSpec;
    requireAuth(u => doPublish(r, spec, name, u), 'log in to publish your puzzle');
  }

  function doPublish(r: FinishResult, spec: PuzzleSpec, name: string, u: User) {
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublish({ kind: 'publishing' });
    api.publishPuzzle({
      name,
      board: boardToBits(spec.board),
      queue: queueToApi(spec.queue),
      requirements: spec.requirements,
      solution: r.solution,
    })
      .then(({ id }) => {
        publishingRef.current = false;
        clearStoredDraft();
        if (mountedRef.current) onPublished({ id, name, creator: u.username, spec });
      })
      .catch(err => {
        publishingRef.current = false;
        if (err instanceof ApiError && err.status === 401) onAuthExpired();
        if (mountedRef.current && resultRef.current === r) {
          setPublish({ kind: 'error', message: publishError(err) });
        }
      });
  }

  // ---- test run ----
  if (testSpec) {
    let overlay = null;
    if (result?.success) {
      overlay = (
        <ResultCard tone="success" title="solved!">
          <RunStats result={result} />
          <form
            className="result-field"
            onSubmit={e => { e.preventDefault(); handlePublish(); }}
          >
            <label className="result-field-label" htmlFor="publish-name">puzzle name</label>
            <input
              id="publish-name"
              ref={nameRef}
              className="text-input"
              type="text"
              value={draft.name}
              onChange={e => patch({ name: e.target.value.slice(0, MAX_NAME) })}
              maxLength={MAX_NAME}
              placeholder="name your puzzle"
              spellCheck={false}
              autoComplete="off"
              disabled={publishing}
            />
          </form>
          {publish.kind === 'error' && <p className="result-note error">{publish.message}</p>}
          <div className="result-actions">
            <CardButton variant="primary" onClick={handlePublish} disabled={publishing}>
              {publishing ? 'publishing…' : user ? 'publish' : 'log in & publish'}
            </CardButton>
          </div>
          <div className="result-actions">
            <CardButton onClick={retry} disabled={publishing}>retry</CardButton>
            <CardButton onClick={backToEditing} disabled={publishing}>back to editing</CardButton>
          </div>
        </ResultCard>
      );
    } else if (result) {
      overlay = (
        <FailureCard result={result} spec={testSpec} onUndo={undo} onRetry={retry}>
          <CardButton variant="link" onClick={backToEditing}>back to editing</CardButton>
        </FailureCard>
      );
    }

    return (
      <div className="create-view testing">
        <div className="create-work">
          <PuzzlePlayer
            ref={playerRef}
            puzzle={testSpec}
            bindings={bindings}
            handling={handling}
            onFinish={handleFinish}
            onReset={handleReset}
            overlay={overlay}
            disabled={inputBlocked || typing || publishing}
          />
        </div>

        <aside className="create-panel">
          <div className="panel-section">
            <span className="panel-label">TEST RUN</span>
            <p className="panel-text">
              solve your puzzle to unlock <strong>publish</strong> — that shows it can be done,
              and it's published exactly as you're playing it now.
            </p>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onMouseDown={noFocus}
            onClick={backToEditing}
            disabled={publishing}
          >
            <ArrowLeft className="glyph-icon glyph-lead" />back to editing
          </button>
        </aside>
      </div>
    );
  }

  // ---- editing ----
  const showProblems = triedTest && problems.length > 0;
  return (
    <div className="create-view">
      <div className="create-work">
        <BoardEditor
          board={draft.board}
          onChange={board => patch({ board })}
          queue={draft.queue}
          bindings={bindings}
          handling={handling}
          disabled={inputBlocked || typing}
        />
      </div>

      <aside className="create-panel">
        <label className="panel-section">
          <span className="panel-label">NAME</span>
          <input
            className="text-input"
            type="text"
            value={draft.name}
            onChange={e => patch({ name: e.target.value.slice(0, MAX_NAME) })}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            maxLength={MAX_NAME}
            placeholder="untitled puzzle"
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <QueueEditor queue={draft.queue} onQueueChange={queue => patch({ queue })} variant="panel" />

        <div className="panel-section">
          <span className="panel-label">GOALS</span>
          <RequirementsEditor
            requirements={draft.requirements}
            onRequirementsChange={requirements => patch({ requirements })}
            invalid={showProblems && !hasCountedGoal(draft.requirements)}
          />
        </div>

        {problems.length > 0 && (
          <ul className={`create-problems${showProblems ? ' error' : ''}`} aria-live="polite">
            {problems.map(p => <li key={p}>{p}</li>)}
          </ul>
        )}

        <button type="button" className="primary-btn" onMouseDown={noFocus} onClick={startTest}>
          <Play className="glyph-icon glyph-lead" />test it
        </button>
        <p className="panel-text">solve it once yourself, then publish.</p>

        <button
          type="button"
          className={`text-btn${confirmClear ? ' danger' : ''}`}
          onMouseDown={noFocus}
          onClick={clearDraft}
          disabled={isBlankDraft(draft)}
        >
          {confirmClear ? 'clear everything? click again' : 'new puzzle'}
        </button>
      </aside>
    </div>
  );
}
