import { useState, useCallback, useRef, useEffect } from 'react';
import {
  BOARD_COLS, BOARD_ROWS, EMPTY, PIECE_TYPES, TETROMINOES,
  getPieceCells, hardDrop, isValidPlacement, rotate,
  ACTION_LEFT, ACTION_RIGHT, ACTION_CW, ACTION_CCW,
  ACTION_SD, ACTION_HOLD, ACTION_NOOP, MAX_ACTIONS, clearLines,
} from '../tetrisUtils';
import { useDasArr } from '../useDasArr';
import PieceMini from './PieceMini';
import './GameBoard.css';

function drawFromQueue(queue, idx) {
  return idx < queue.length ? queue[idx] : null;
}

export default function GameBoard({ initialBoard, queue, onComplete, onProgress, reqText }) {
  const [playBoard, setPlayBoard]       = useState(() => initialBoard.map(r => [...r]));
  const [consumedIdx, setConsumedIdx]   = useState(1);
  const [currentPiece, setCurrentPiece] = useState(queue[0] ?? null);
  const [held, setHeld]                 = useState(null);
  const [hasHeld, setHasHeld]           = useState(false);
  const [rotation, setRotation]         = useState(0);
  const [pieceRow, setPieceRow]         = useState(0);
  const [pieceCol, setPieceCol]         = useState(3);
  const [currentActions, setCurrentActions] = useState([]);
  const [placedMoves, setPlacedMoves]   = useState([]);
  const [done, setDone]                 = useState(false);

  const containerRef = useRef(null);
  useEffect(() => { containerRef.current?.focus(); }, []);

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

  function doPlace(board, piece, rot, row, col, actions, consumed, soFar) {
    const landRow = hardDrop(board, piece, rot, row, col);
    if (!isValidPlacement(board, piece, rot, landRow, col)) return;

    const tmp = board.map(r => [...r]);
    for (const { row: pr, col: pc } of getPieceCells(piece, rot, landRow, col)) tmp[pr][pc] = piece;
    const newBoard = clearLines(tmp);

    const padded = [...actions];
    while (padded.length < MAX_ACTIONS) padded.push(ACTION_NOOP);
    const newPlaced = [...soFar, padded];

    if (newPlaced.length >= queue.length) {
      setPlayBoard(newBoard);
      setPlacedMoves(newPlaced);
      setCurrentPiece(null);
      setDone(true);
      onProgress?.(newPlaced.length);
      onComplete(newPlaced);
      return;
    }

    let nextPiece = drawFromQueue(queue, consumed);
    let startActions = [];
    if (nextPiece == null && held != null) {
      // queue exhausted — spawn the held piece. The circuit models this as the
      // null piece spawning and an explicit hold retrieving the held piece, so
      // the move list for this final piece must begin with a hold action.
      nextPiece = held;
      setHeld(null);
      startActions = [ACTION_HOLD];
    }
    setPlayBoard(newBoard);
    setPlacedMoves(newPlaced);
    setConsumedIdx(consumed + 1);
    setCurrentPiece(nextPiece);
    setHasHeld(false);
    setCurrentActions(startActions);
    setRotation(0); setPieceRow(0); setPieceCol(3);
    onProgress?.(newPlaced.length);
  }

  function moveHorizontal(dir) {
    if (done || currentPiece == null) return;
    if (isValidPlacement(playBoard, currentPiece, rotation, pieceRow, pieceCol + dir)) {
      const n = tryAddAction(dir < 0 ? ACTION_LEFT : ACTION_RIGHT, currentActions);
      if (n) { setCurrentActions(n); setPieceCol(c => c + dir); }
    }
  }

  function moveDown() {
    if (done || currentPiece == null) return;
    if (isValidPlacement(playBoard, currentPiece, rotation, pieceRow + 1, pieceCol)) {
      const n = tryAddAction(ACTION_SD, currentActions);
      if (n) { setCurrentActions(n); setPieceRow(r => r + 1); }
    }
  }

  const das = useDasArr({
    left:  () => moveHorizontal(-1),
    right: () => moveHorizontal(1),
    down:  moveDown,
  });

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (e.repeat) return; // we do our own repeat
      if (e.key === 'ArrowLeft')  das.start('left');
      if (e.key === 'ArrowRight') das.start('right');
      if (e.key === 'ArrowDown')  das.start('down');
      return;
    }

    if (e.repeat || done || currentPiece == null) return;

    switch (e.key) {
      case 'ArrowUp': case 'x': case 'X': {
        e.preventDefault();
        const [nr, nrow, ncol] = rotate(playBoard, currentPiece, rotation, pieceRow, pieceCol, true);
        if (nr !== rotation || nrow !== pieceRow || ncol !== pieceCol) {
          const n = tryAddAction(ACTION_CW, currentActions);
          if (n) { setCurrentActions(n); setRotation(nr); setPieceRow(nrow); setPieceCol(ncol); }
        }
        break;
      }
      case 'z': case 'Z': {
        e.preventDefault();
        const [nr, nrow, ncol] = rotate(playBoard, currentPiece, rotation, pieceRow, pieceCol, false);
        if (nr !== rotation || nrow !== pieceRow || ncol !== pieceCol) {
          const n = tryAddAction(ACTION_CCW, currentActions);
          if (n) { setCurrentActions(n); setRotation(nr); setPieceRow(nrow); setPieceCol(ncol); }
        }
        break;
      }
      case 'c': case 'C': {
        e.preventDefault();
        if (hasHeld) break;
        const nextActions = tryAddAction(ACTION_HOLD, currentActions);
        if (!nextActions) break;
        if (held === null) {
          const next = drawFromQueue(queue, consumedIdx);
          if (next == null) break;
          setHeld(currentPiece); setCurrentPiece(next); setConsumedIdx(c => c + 1);
        } else {
          const tmp = held; setHeld(currentPiece); setCurrentPiece(tmp);
        }
        setCurrentActions(nextActions); setHasHeld(true);
        setRotation(0); setPieceRow(0); setPieceCol(3);
        break;
      }
      case ' ': {
        e.preventDefault();
        doPlace(playBoard, currentPiece, rotation, pieceRow, pieceCol, currentActions, consumedIdx, placedMoves);
        break;
      }
      default: break;
    }
  }

  function handleKeyUp(e) {
    if (e.key === 'ArrowLeft')  das.stop('left');
    if (e.key === 'ArrowRight') das.stop('right');
    if (e.key === 'ArrowDown')  das.stop('down');
  }

  return (
    <div
      className="game-board-container"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={das.stopAll}
      ref={containerRef}
      style={{ outline: 'none' }}
    >
      {/* board: hold | (spacer + grid)  (same structure as TetrisBoard) */}
      <div className="board-layout">
        <div className="board-side-panel left">
          <div className="hold-box">
            <PieceMini pieceId={held} size={12} dimmed={hasHeld} />
          </div>
        </div>

        <div className="board-column">
        {/* same height as edit-mode toolbar; shows requirements once set */}
        <div className="game-toolbar-row">
          {reqText && <span className="req-summary">{reqText}</span>}
        </div>

        <div className="tetris-grid play-grid">
          {playBoard.map((row, rowIdx) =>
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
                    gridRow:    rowIdx + 1,
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

