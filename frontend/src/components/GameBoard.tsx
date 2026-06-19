import { useState, useRef, useEffect, type ReactNode, type CSSProperties } from 'react';
import {
  EMPTY, PIECE_TYPES,
  getPieceCells, hardDrop, isValidPlacement, rotate,
  ACTION_LEFT, ACTION_RIGHT, ACTION_CW, ACTION_CCW,
  ACTION_SD, ACTION_HOLD, ACTION_NOOP, MAX_ACTIONS, clearLines, spawnCol,
  type Board, type Action, type SecretMoves,
} from '../tetrisUtils';
import { useDasArr } from '../useDasArr';
import { keySig, normKey, baseKey, type Bindings, type Handling } from '../keybindings';
import { emptyLedger, lockLedger, type Ledger } from '../tetrisLedger';
import PieceMini from './PieceMini';
import type { QueueView } from './TetrisBoard';
import './GameBoard.css';

function drawFromQueue(queue: number[], idx: number): number | null {
  return idx < queue.length ? queue[idx] : null;
}

interface TurnSnapshot {
  piece: number | null;
  held: number | null;
  consumedIdx: number;
  baseActions: Action[];
}

interface HistoryEntry extends TurnSnapshot {
  board: Board;
  ledger: Ledger;
  placedMoves: SecretMoves;
}

interface GameBoardProps {
  initialBoard: Board;
  queue: number[];
  onComplete: (moves: SecretMoves | null) => void;
  onQueueView?: (view: QueueView) => void;
  onLedger?: (ledger: Ledger) => void;
  reqText: string | null;
  reqsDone: boolean;
  noHold: boolean;
  keys: Bindings;
  handling: Handling;
  sidePanel?: ReactNode;
}

export default function GameBoard({ initialBoard, queue, onComplete, onQueueView, onLedger, reqText, reqsDone, noHold, keys, handling, sidePanel }: GameBoardProps) {
  const [playBoard, setPlayBoard]       = useState<Board>(() => initialBoard.map(r => [...r]));
  const [consumedIdx, setConsumedIdx]   = useState(1);
  const [currentPiece, setCurrentPiece] = useState<number | null>(queue[0] ?? null);
  const [held, setHeld]                 = useState<number | null>(null);
  const [rotation, setRotation]         = useState(0);
  const [pieceRow, setPieceRow]         = useState(0);
  const [pieceCol, setPieceCol]         = useState(() => spawnCol(queue[0]));
  const [currentActions, setCurrentActions] = useState<Action[]>([]);
  const [placedMoves, setPlacedMoves]   = useState<SecretMoves>([]);
  const [done, setDone]                 = useState(false);
  const [ledger, setLedger]             = useState<Ledger>(emptyLedger);
  const [overflowWarn, setOverflowWarn] = useState(false);

  // snapshot of the state when the current piece spawned, so the turn can be
  // replayed from scratch when the 32-action budget runs out
  const turnStartRef = useRef<TurnSnapshot>({
    piece: queue[0] ?? null,
    held: null,
    consumedIdx: 1,
    baseActions: [],
  });
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // one snapshot per locked piece, for undo
  const historyRef = useRef<HistoryEntry[]>([]);

  const lastRotateRef = useRef(false);

  const handlersRef = useRef<{ down: (e: KeyboardEvent) => void; up: (e: KeyboardEvent) => void; stopAll: () => void }>(null!);
  handlersRef.current = { down: handleKeyDown, up: handleKeyUp, stopAll: () => das.stopAll() };

  useEffect(() => {
    function ignoring(e: KeyboardEvent) {
      const t = e.target;
      return t instanceof HTMLElement && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.isContentEditable || t.closest('.modal-overlay')
      );
    }
    const down = (e: KeyboardEvent) => { if (!ignoring(e)) handlersRef.current.down(e); };
    const up   = (e: KeyboardEvent) => handlersRef.current.up(e);
    const blur = () => handlersRef.current.stopAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // keep the queue sidebar in sync with the real piece flow (incl. holds)
  useEffect(() => {
    onQueueView?.({ current: currentPiece, nextIdx: consumedIdx });
  }, [currentPiece, consumedIdx, onQueueView]);

  useEffect(() => {
    onLedger?.(ledger);
  }, [ledger, onLedger]);

  const ghostRow = currentPiece != null
    ? hardDrop(playBoard, currentPiece, rotation, pieceRow, pieceCol)
    : pieceRow;

  const activeCells = currentPiece != null ? getPieceCells(currentPiece, rotation, pieceRow, pieceCol) : [];
  const ghostCells  = currentPiece != null ? getPieceCells(currentPiece, rotation, ghostRow, pieceCol)  : [];
  const activeSet   = new Set(activeCells.map(c => `${c.row},${c.col}`));
  const ghostSet    = new Set(ghostCells.map(c => `${c.row},${c.col}`));

  function tryAddAction(action: Action, actions: Action[]): Action[] | null {
    if (actions.length >= MAX_ACTIONS) return null;
    return [...actions, action];
  }

  // 33rd action: rewind the whole turn to how the piece spawned
  function resetPiece() {
    const s = turnStartRef.current;
    das.stopAll();
    setCurrentPiece(s.piece);
    setHeld(s.held);
    setConsumedIdx(s.consumedIdx);
    setCurrentActions([...s.baseActions]);
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(s.piece));
    lastRotateRef.current = false;
    setOverflowWarn(true);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setOverflowWarn(false), 3000);
  }

  // restart the whole solve: restore the puzzle's initial board + full queue, exactly
  // as it was when this puzzle first loaded (mirrors the initial useState values).
  function restartSolve() {
    das.stopAll();
    setPlayBoard(initialBoard.map(r => [...r]));
    setConsumedIdx(1);
    setCurrentPiece(queue[0] ?? null);
    setHeld(null);
    setRotation(0);
    setPieceRow(0);
    setPieceCol(spawnCol(queue[0]));
    setCurrentActions([]);
    setPlacedMoves([]);
    setDone(false);
    setLedger(emptyLedger());
    setOverflowWarn(false);
    turnStartRef.current = { piece: queue[0] ?? null, held: null, consumedIdx: 1, baseActions: [] };
    historyRef.current = [];
    lastRotateRef.current = false;
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    onComplete(null); // any completed solve is now void
  }

  function doPlace(board: Board, piece: number, rot: number, row: number, col: number, actions: Action[], consumed: number, soFar: SecretMoves) {
    const landRow = hardDrop(board, piece, rot, row, col);
    if (!isValidPlacement(board, piece, rot, landRow, col)) return;

    // snapshot the state at this turn's start so the lock can be undone
    historyRef.current.push({
      board: board.map(r => [...r]),
      ledger,
      placedMoves: soFar,
      ...turnStartRef.current,
    });

    const tmp = board.map(r => [...r]);
    for (const { row: pr, col: pc } of getPieceCells(piece, rot, landRow, col)) tmp[pr][pc] = piece;
    const newBoard = clearLines(tmp);

    // mirror circuit lock_piece: t-spin only counts if the piece couldn't drop.
    // Snapshot the rotation flag NOW — the updater below runs later, after the
    // ref has been reset for the next piece.
    const linesCleared = tmp.filter(r => r.every(c => c !== EMPTY)).length;
    const wasSpin = lastRotateRef.current && landRow === row;
    const heldOccupied = held != null;
    const newLedger = lockLedger(ledger, {
      boardBefore: board,
      boardCleared: newBoard,
      linesCleared,
      pieceId: piece,
      landRow,
      col,
      lastActionRotate: wasSpin,
      heldOccupied,
    });
    setLedger(newLedger);
    lastRotateRef.current = false;

    const padded = [...actions];
    while (padded.length < MAX_ACTIONS) padded.push(ACTION_NOOP);
    const newPlaced = [...soFar, padded];

    if (newPlaced.length >= queue.length) {
      setPlayBoard(newBoard);
      setPlacedMoves(newPlaced);
      setCurrentPiece(null);
      setDone(true);
      // Push the final ledger to the parent in the SAME batch as onComplete so reqsDone is
      // already current when secretMoves appears. Otherwise the ledger lags one render (it
      // propagates via the onLedger effect) and "conditions not met" flashes for a frame.
      onLedger?.(newLedger);
      onComplete(newPlaced);
      return;
    }

    let nextPiece = drawFromQueue(queue, consumed);
    let startActions: Action[] = [];
    let heldAfter = held;
    if (nextPiece == null && held != null) {
      // queue exhausted — spawn the held piece. The circuit models this as the
      // null piece spawning and an explicit hold retrieving the held piece, so
      // the move list for this final piece must begin with a hold action.
      nextPiece = held;
      heldAfter = null;
      setHeld(null);
      startActions = [ACTION_HOLD];
    }
    turnStartRef.current = {
      piece: nextPiece,
      held: heldAfter,
      consumedIdx: consumed + 1,
      baseActions: startActions,
    };
    setPlayBoard(newBoard);
    setPlacedMoves(newPlaced);
    setConsumedIdx(consumed + 1);
    setCurrentPiece(nextPiece);
    setCurrentActions(startActions);
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(nextPiece));
  }

  function moveHorizontal(dir: number) {
    if (done || currentPiece == null) return;
    if (isValidPlacement(playBoard, currentPiece, rotation, pieceRow, pieceCol + dir)) {
      const n = tryAddAction(dir < 0 ? ACTION_LEFT : ACTION_RIGHT, currentActions);
      if (!n) { resetPiece(); return; }
      setCurrentActions(n); setPieceCol(c => c + dir); lastRotateRef.current = false;
    }
  }

  function moveDown() {
    if (done || currentPiece == null) return;
    if (isValidPlacement(playBoard, currentPiece, rotation, pieceRow + 1, pieceCol)) {
      const n = tryAddAction(ACTION_SD, currentActions);
      if (!n) { resetPiece(); return; }
      setCurrentActions(n); setPieceRow(r => r + 1); lastRotateRef.current = false;
    }
  }

  const das = useDasArr({
    left:  () => moveHorizontal(-1),
    right: () => moveHorizontal(1),
    down:  moveDown,
  }, handling);

  function doRotate(cw: boolean) {
    if (currentPiece == null) return;
    const [nr, nrow, ncol] = rotate(playBoard, currentPiece, rotation, pieceRow, pieceCol, cw);
    if (nr !== rotation || nrow !== pieceRow || ncol !== pieceCol) {
      const n = tryAddAction(cw ? ACTION_CW : ACTION_CCW, currentActions);
      if (!n) { resetPiece(); return; }
      setCurrentActions(n); setRotation(nr); setPieceRow(nrow); setPieceCol(ncol); lastRotateRef.current = true;
    }
  }

  function undoTurn() {
    const h = historyRef.current.pop();
    if (!h) return;
    das.stopAll();
    setPlayBoard(h.board.map(r => [...r]));
    setLedger(h.ledger);
    setPlacedMoves(h.placedMoves);
    setConsumedIdx(h.consumedIdx);
    setCurrentPiece(h.piece);
    setHeld(h.held);
    setCurrentActions([...h.baseActions]);
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(h.piece));
    turnStartRef.current = {
      piece: h.piece, held: h.held,
      consumedIdx: h.consumedIdx, baseActions: h.baseActions,
    };
    lastRotateRef.current = false;
    if (done) {
      setDone(false);
      onComplete(null); // solve is no longer complete
    }
  }

  function doHold() {
    if (noHold) return; // hold is disabled when "no hold" is a requirement
    const startHeldEmpty = turnStartRef.current.held == null;
    const n = currentActions.filter(a => a === ACTION_HOLD).length + 1;
    const canonical = startHeldEmpty ? ((n - 1) % 2) + 1 : n % 2;

    let incoming: number | null;
    if (held === null) {
      incoming = drawFromQueue(queue, consumedIdx);
      if (incoming == null) return;
      setHeld(currentPiece); setCurrentPiece(incoming); setConsumedIdx(c => c + 1);
    } else {
      incoming = held; setHeld(currentPiece); setCurrentPiece(incoming);
    }
    setCurrentActions(new Array(canonical).fill(ACTION_HOLD));
    // the deleted prefix had the only rotations; the replayed history has none
    lastRotateRef.current = false;
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(incoming));
  }

  function handleKeyDown(e: KeyboardEvent) {
    const k = keySig(e);

    if (k === keys.left || k === keys.right || k === keys.softDrop) {
      e.preventDefault();
      if (e.repeat) return; // we do our own repeat
      if (k === keys.left)     das.start('left');
      if (k === keys.right)    das.start('right');
      if (k === keys.softDrop) das.start('down');
      return;
    }

    if (e.repeat) return;

    // undo and clear-board work even after the last piece locks
    if (k === keys.undo) { e.preventDefault(); undoTurn(); return; }
    if (k === keys.clearBoard) { e.preventDefault(); restartSolve(); return; }

    if (done || currentPiece == null) return;

    if (k === keys.rotateCw)  { e.preventDefault(); doRotate(true);  return; }
    if (k === keys.rotateCcw) { e.preventDefault(); doRotate(false); return; }
    if (k === keys.hold)      { e.preventDefault(); doHold();        return; }
    if (k === keys.place) {
      e.preventDefault();
      doPlace(playBoard, currentPiece, rotation, pieceRow, pieceCol, currentActions, consumedIdx, placedMoves);
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    // match on the unmodified key so a modifier press/release mid-hold
    // can't leave auto-repeat running
    const k = normKey(e.key);
    if (k === baseKey(keys.left))     das.stop('left');
    if (k === baseKey(keys.right))    das.stop('right');
    if (k === baseKey(keys.softDrop)) das.stop('down');
  }

  return (
    <div
      className="game-board-container"
      style={{ outline: 'none' }}
    >
      {/* board: hold | (spacer + grid)  (same structure as TetrisBoard) */}
      <div className="board-layout">
        <div className="board-side-panel left">
          <div className={`hold-box${noHold ? ' disabled' : ''}`} title={noHold ? 'hold disabled (no hold required)' : undefined}>
            <PieceMini pieceId={held} size={12} />
          </div>
          {overflowWarn && (
            <div className="overflow-warn">
              piece reset: max 32 moves per piece 
            </div>
          )}
          {sidePanel}
        </div>

        <div className="board-column">
        {/* same height as edit-mode toolbar */}
        <div className="game-toolbar-row">
          {reqText && (
            <span className={`req-summary ${reqsDone ? 'met' : ''}`}>
              {reqText}
            </span>
          )}
        </div>

        <div className="tetris-grid play-grid">
          {/* row 0 is the hidden spawn row; only rows 1-20 are shown */}
          {playBoard.map((row, rowIdx) =>
            rowIdx === 0 ? null :
            row.map((cell, colIdx) => {
              const key = `${rowIdx},${colIdx}`;
              const isActive = activeSet.has(key);
              const isGhost  = !isActive && ghostSet.has(key);
              const pieceColor  = cell ? PIECE_TYPES[cell]?.color : null;
              const activeColor = isActive && currentPiece ? PIECE_TYPES[currentPiece]?.color : null;
              const ghostColor  = isGhost  && currentPiece ? PIECE_TYPES[currentPiece]?.color : null;
              return (
                <div
                  key={key}
                  className={`cell ${cell ? 'filled' : ''} ${isActive ? 'active-piece' : ''} ${isGhost ? 'ghost-piece' : ''}`}
                  style={{
                    '--cell-color':   pieceColor  ?? 'transparent',
                    '--active-color': activeColor ?? 'transparent',
                    '--ghost-color':  ghostColor  ?? 'transparent',
                    gridColumn: colIdx + 1,
                    gridRow:    rowIdx, // shifted up: hidden row 0
                  } as CSSProperties}
                />
              );
            })
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
