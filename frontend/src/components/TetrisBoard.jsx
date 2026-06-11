import { useState, useEffect, useRef } from 'react';
import {
  BOARD_COLS, BOARD_ROWS, NUM_PIECES, EMPTY, PIECE_TYPES,
  getPieceCells, hardDrop, isValidPlacement, rotate, spawnCol,
} from '../tetrisUtils';
import { useDasArr } from '../useDasArr';
import { normKey } from '../keybindings';
import PieceMini from './PieceMini';
import './TetrisBoard.css';

export default function TetrisBoard({ board, onCellToggle, onPiecePlaced, onQueueView, queue, keys, handling }) {
  const [selectedPaint, setSelectedPaint] = useState(1);

  // piece flow (same model as solve mode, minus move recording)
  const [queuePos, setQueuePos]         = useState(1);
  const [currentPiece, setCurrentPiece] = useState(queue[0] ?? null);
  const [held, setHeld]                 = useState(null);
  const [rotation, setRotation]         = useState(0);
  const [pieceRow, setPieceRow]         = useState(0);
  const [pieceCol, setPieceCol]         = useState(() => spawnCol(queue[0]));

  // restart the flow whenever the queue is edited
  useEffect(() => {
    setQueuePos(1);
    setCurrentPiece(queue[0] ?? null);
    setHeld(null);
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(queue[0]));
  }, [queue]);

  // keep the queue sidebar in sync with the real piece flow (incl. holds)
  useEffect(() => {
    onQueueView?.({ current: currentPiece, nextIdx: queuePos });
  }, [currentPiece, queuePos, onQueueView]);

  // global key handling — no need to focus the board. Ignores keys typed
  // into inputs or while a modal is open.
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

  const ghostRow = currentPiece != null
    ? hardDrop(board, currentPiece, rotation, pieceRow, pieceCol)
    : pieceRow;

  const activeCells = currentPiece != null ? getPieceCells(currentPiece, rotation, pieceRow, pieceCol) : [];
  const ghostCells  = currentPiece != null ? getPieceCells(currentPiece, rotation, ghostRow,  pieceCol) : [];
  const activeSet   = new Set(activeCells.map(c => `${c.row},${c.col}`));
  const ghostSet    = new Set(ghostCells.map(c => `${c.row},${c.col}`));

  function handleCellClick(row, col) {
    const cur = board[row][col];
    onCellToggle(row, col, cur === selectedPaint ? EMPTY : selectedPaint);
  }

  function shiftPiece(dir) {
    if (!currentPiece) return;
    if (isValidPlacement(board, currentPiece, rotation, pieceRow, pieceCol + dir))
      setPieceCol(c => c + dir);
  }

  function rotatePiece(cw) {
    if (!currentPiece) return;
    const [nr, nrow, ncol] = rotate(board, currentPiece, rotation, pieceRow, pieceCol, cw);
    setRotation(nr); setPieceRow(nrow); setPieceCol(ncol);
  }

  function softDrop() {
    if (!currentPiece) return;
    if (isValidPlacement(board, currentPiece, rotation, pieceRow + 1, pieceCol))
      setPieceRow(r => r + 1);
  }

  function placePiece() {
    if (!currentPiece) return;
    const landRow = hardDrop(board, currentPiece, rotation, pieceRow, pieceCol);
    if (!isValidPlacement(board, currentPiece, rotation, landRow, pieceCol)) return;
    onPiecePlaced(getPieceCells(currentPiece, rotation, landRow, pieceCol), currentPiece);
    let next = queue[queuePos] ?? null;
    if (next == null && held != null) {
      // queue exhausted — spawn the held piece
      next = held;
      setHeld(null);
    }
    setCurrentPiece(next);
    setQueuePos(p => p + 1);
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(next));
  }

  function holdPiece() {
    if (!currentPiece) return;
    let incoming;
    if (held === null) {
      incoming = queue[queuePos] ?? null;
      if (incoming == null) return;
      setHeld(currentPiece);
      setCurrentPiece(incoming);
      setQueuePos(p => p + 1);
    } else {
      incoming = held;
      setHeld(currentPiece);
      setCurrentPiece(incoming);
    }
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(incoming));
  }

  const das = useDasArr({
    left:  () => shiftPiece(-1),
    right: () => shiftPiece(1),
    down:  softDrop,
  }, handling);

  function handleKeyDown(e) {
    const k = normKey(e.key);
    if (k === keys.left || k === keys.right || k === keys.softDrop) {
      e.preventDefault();
      if (e.repeat) return;
      if (k === keys.left)     das.start('left');
      if (k === keys.right)    das.start('right');
      if (k === keys.softDrop) das.start('down');
      return;
    }
    if (e.repeat) return;
    if (k === keys.rotateCw)  { e.preventDefault(); rotatePiece(true);  return; }
    if (k === keys.rotateCcw) { e.preventDefault(); rotatePiece(false); return; }
    if (k === keys.hold)      { e.preventDefault(); holdPiece();        return; }
    if (k === keys.place)     { e.preventDefault(); placePiece();       }
  }

  function handleKeyUp(e) {
    const k = normKey(e.key);
    if (k === keys.left)     das.stop('left');
    if (k === keys.right)    das.stop('right');
    if (k === keys.softDrop) das.stop('down');
  }

  return (
    <div className="tetris-board-container">
      {/* hold | (toolbar + grid) */}
      <div className="board-layout">
        <div className="board-side-panel left">
          <div className="hold-box">
            <PieceMini pieceId={held} size={12} />
          </div>
        </div>

        <div className="board-column">
        {/* Toolbar: paint palette, same width as the grid */}
        <div className="board-toolbar">
          <div className="paint-palette">
            {[8, 1, 2, 3, 4, 5, 6, 7].map(id => (
              <button
                key={id}
                className={`palette-swatch ${selectedPaint === id ? 'active' : ''}`}
                style={{ background: PIECE_TYPES[id].color }}
                title={PIECE_TYPES[id].name}
                onClick={() => setSelectedPaint(id)}
              />
            ))}
            <button
              className={`palette-swatch eraser ${selectedPaint === EMPTY ? 'active' : ''}`}
              onClick={() => setSelectedPaint(EMPTY)}
              title="Eraser"
            >✕</button>
          </div>
        </div>

        <div className="tetris-grid">
          {board.map((row, rowIdx) =>
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
                  className={`cell ${cell ? 'filled' : ''} ${isActive ? 'active-piece' : ''} ${isGhost ? 'ghost-edit' : ''}`}
                  style={{
                    '--cell-color':   pieceColor  ?? 'transparent',
                    '--active-color': activeColor ?? 'transparent',
                    '--ghost-color':  ghostColor  ?? 'transparent',
                    gridColumn: colIdx + 1,
                    gridRow:    rowIdx + 1,
                  }}
                  onClick={() => handleCellClick(rowIdx, colIdx)}
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
