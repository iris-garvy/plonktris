import { useState, useEffect } from 'react';
import {
  BOARD_COLS, BOARD_ROWS, NUM_PIECES, EMPTY, PIECE_TYPES,
  getPieceCells, hardDrop, isValidPlacement, rotate,
} from '../tetrisUtils';
import { useDasArr } from '../useDasArr';
import PieceMini from './PieceMini';
import './TetrisBoard.css';

export default function TetrisBoard({ board, onCellToggle, onPiecePlaced, onProgress, queue }) {
  const [selectedPaint, setSelectedPaint] = useState(1);

  // piece flow (same model as solve mode, minus move recording)
  const [queuePos, setQueuePos]         = useState(1);
  const [currentPiece, setCurrentPiece] = useState(queue[0] ?? null);
  const [held, setHeld]                 = useState(null);
  const [hasHeld, setHasHeld]           = useState(false);
  const [rotation, setRotation]         = useState(0);
  const [pieceRow, setPieceRow]         = useState(0);
  const [pieceCol, setPieceCol]         = useState(3);

  // restart the flow whenever the queue is edited
  useEffect(() => {
    setQueuePos(1);
    setCurrentPiece(queue[0] ?? null);
    setHeld(null);
    setHasHeld(false);
    setRotation(0); setPieceRow(0); setPieceCol(3);
  }, [queue]);

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
    setHasHeld(false);
    setRotation(0); setPieceRow(0); setPieceCol(3);
    onProgress?.(queuePos);
  }

  function holdPiece() {
    if (!currentPiece || hasHeld) return;
    if (held === null) {
      const next = queue[queuePos] ?? null;
      if (next == null) return;
      setHeld(currentPiece);
      setCurrentPiece(next);
      setQueuePos(p => p + 1);
      onProgress?.(queuePos);
    } else {
      const tmp = held;
      setHeld(currentPiece);
      setCurrentPiece(tmp);
    }
    setHasHeld(true);
    setRotation(0); setPieceRow(0); setPieceCol(3);
  }

  const das = useDasArr({
    left:  () => shiftPiece(-1),
    right: () => shiftPiece(1),
    down:  softDrop,
  });

  function handleKeyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (e.repeat) return;
      if (e.key === 'ArrowLeft')  das.start('left');
      if (e.key === 'ArrowRight') das.start('right');
      if (e.key === 'ArrowDown')  das.start('down');
      return;
    }
    if (e.repeat) return;
    switch (e.key) {
      case 'ArrowUp': case 'x': case 'X': e.preventDefault(); rotatePiece(true);  break;
      case 'z': case 'Z':                  e.preventDefault(); rotatePiece(false); break;
      case 'c': case 'C':                  e.preventDefault(); holdPiece();        break;
      case ' ':                            e.preventDefault(); placePiece();        break;
      default: break;
    }
  }

  function handleKeyUp(e) {
    if (e.key === 'ArrowLeft')  das.stop('left');
    if (e.key === 'ArrowRight') das.stop('right');
    if (e.key === 'ArrowDown')  das.stop('down');
  }

  return (
    <div className="tetris-board-container" tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} onBlur={das.stopAll} style={{ outline: 'none' }}>
      {/* hold | (toolbar + grid) */}
      <div className="board-layout">
        <div className="board-side-panel left">
          <div className="hold-box">
            <PieceMini pieceId={held} size={12} dimmed={hasHeld} />
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
