import { useState, useCallback, useRef, useEffect } from 'react';
import {
  BOARD_COLS, BOARD_ROWS, EMPTY, PIECE_TYPES, TETROMINOES,
  getPieceCells, hardDrop, isValidPlacement, rotate,
  ACTION_LEFT, ACTION_RIGHT, ACTION_CW, ACTION_CCW,
  ACTION_SD, ACTION_HOLD, ACTION_NOOP, MAX_ACTIONS, clearLines, spawnCol,
} from '../tetrisUtils';
import { useDasArr } from '../useDasArr';
import { keySig, normKey, baseKey } from '../keybindings';
import { emptyLedger, lockLedger } from '../tetrisLedger';
import PieceMini from './PieceMini';
import './GameBoard.css';

function drawFromQueue(queue, idx) {
  return idx < queue.length ? queue[idx] : null;
}

export default function GameBoard({ initialBoard, queue, onComplete, onQueueView, onLedger, reqText, reqsDone, keys, handling }) {
  const [playBoard, setPlayBoard]       = useState(() => initialBoard.map(r => [...r]));
  const [consumedIdx, setConsumedIdx]   = useState(1);
  const [currentPiece, setCurrentPiece] = useState(queue[0] ?? null);
  const [held, setHeld]                 = useState(null);
  const [rotation, setRotation]         = useState(0);
  const [pieceRow, setPieceRow]         = useState(0);
  const [pieceCol, setPieceCol]         = useState(() => spawnCol(queue[0]));
  const [currentActions, setCurrentActions] = useState([]);
  const [placedMoves, setPlacedMoves]   = useState([]);
  const [done, setDone]                 = useState(false);
  const [ledger, setLedger]             = useState(emptyLedger);
  const [overflowWarn, setOverflowWarn] = useState(false);

  // snapshot of the state when the current piece spawned, so the turn can be
  // replayed from scratch when the 32-action budget runs out
  const turnStartRef = useRef({
    piece: queue[0] ?? null,
    held: null,
    consumedIdx: 1,
    baseActions: [],
  });
  const warnTimerRef = useRef(null);

  // one snapshot per locked piece, for undo
  const historyRef = useRef([]);

  // circuit's last_action_was_rotation flag: set by a successful rotation,
  // cleared by a successful shift/soft-drop, untouched by hold, reset per piece
  const lastRotateRef = useRef(false);

  // global key handling — no need to focus the board. Ignores keys typed
  // into inputs or while a modal is open; keyup always passes (stopping DAS
  // is always safe).
  const handlersRef = useRef({});
  handlersRef.current = { down: handleKeyDown, up: handleKeyUp, stopAll: () => das.stopAll() };

  useEffect(() => {
    function ignoring(e) {
      const t = e.target;
      return t instanceof HTMLElement && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
        t.isContentEditable || t.closest('.modal-overlay')
      );
    }
    const down = e => { if (!ignoring(e)) handlersRef.current.down(e); };
    const up   = e => handlersRef.current.up(e);
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

  function tryAddAction(action, actions) {
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
    clearTimeout(warnTimerRef.current);
    warnTimerRef.current = setTimeout(() => setOverflowWarn(false), 3000);
  }

  function doPlace(board, piece, rot, row, col, actions, consumed, soFar) {
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

    // mirror circuit lock_piece: t-spin only counts if the piece couldn't drop
    const linesCleared = tmp.filter(r => r.every(c => c !== EMPTY)).length;
    setLedger(prev => lockLedger(prev, {
      boardBefore: board,
      boardCleared: newBoard,
      linesCleared,
      pieceId: piece,
      landRow,
      col,
      lastActionRotate: lastRotateRef.current && landRow === row,
      heldOccupied: held != null,
    }));
    lastRotateRef.current = false;

    const padded = [...actions];
    while (padded.length < MAX_ACTIONS) padded.push(ACTION_NOOP);
    const newPlaced = [...soFar, padded];

    if (newPlaced.length >= queue.length) {
      setPlayBoard(newBoard);
      setPlacedMoves(newPlaced);
      setCurrentPiece(null);
      setDone(true);
      onComplete(newPlaced);
      return;
    }

    let nextPiece = drawFromQueue(queue, consumed);
    let startActions = [];
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

  function moveHorizontal(dir) {
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

  function doRotate(cw) {
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
      onComplete?.(null); // solve is no longer complete
    }
  }

  function doHold() {
    // Moves before a hold are moot — the outgoing piece's position is
    // discarded — so they're deleted from the record. Hold chains also
    // cancel pairwise (a swap undoes a swap); the only irreversible part is
    // a first-hold from an empty slot, which consumes a queue piece. So the
    // canonical record is at most two HOLDs.
    const startHeldEmpty = turnStartRef.current.held == null;
    const n = currentActions.filter(a => a === ACTION_HOLD).length + 1;
    const canonical = startHeldEmpty ? ((n - 1) % 2) + 1 : n % 2;

    let incoming;
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

  function handleKeyDown(e) {
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

    // undo works even after the last piece locks
    if (k === keys.undo) { e.preventDefault(); undoTurn(); return; }

    if (done || currentPiece == null) return;

    if (k === keys.rotateCw)  { e.preventDefault(); doRotate(true);  return; }
    if (k === keys.rotateCcw) { e.preventDefault(); doRotate(false); return; }
    if (k === keys.hold)      { e.preventDefault(); doHold();        return; }
    if (k === keys.place) {
      e.preventDefault();
      doPlace(playBoard, currentPiece, rotation, pieceRow, pieceCol, currentActions, consumedIdx, placedMoves);
    }
  }

  function handleKeyUp(e) {
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
          <div className="hold-box">
            <PieceMini pieceId={held} size={12} />
          </div>
          {overflowWarn && (
            <div className="overflow-warn">
              max 32 moves per piece — piece reset
            </div>
          )}
        </div>

        <div className="board-column">
        {/* same height as edit-mode toolbar; shows live requirement progress */}
        <div className="game-toolbar-row">
          {reqText && (
            <span className={`req-summary ${reqsDone ? 'met' : ''}`}>
              {reqsDone ? '✓ ' : ''}{reqText}
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
                  }}
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

