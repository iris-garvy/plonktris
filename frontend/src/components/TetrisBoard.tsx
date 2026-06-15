import { useState, useEffect, useRef, type ReactNode, type CSSProperties } from 'react';
import { Eraser } from 'lucide-react';
import {
  BOARD_COLS, BOARD_ROWS, EMPTY, PIECE_TYPES,
  getPieceCells, hardDrop, isValidPlacement, rotate, spawnCol,
  type Board, type CellPos,
} from '../tetrisUtils';
import { useDasArr } from '../useDasArr';
import { keySig, normKey, baseKey, type Bindings, type Handling } from '../keybindings';
import PieceMini from './PieceMini';
import './TetrisBoard.css';

export interface QueueView {
  current: number | null;
  nextIdx: number;
}

interface EditTurnSnapshot {
  piece: number | null;
  held: number | null;
  queuePos: number;
}

interface EditHistoryEntry extends EditTurnSnapshot {
  board: Board;
}

interface TetrisBoardProps {
  board: Board;
  onCellToggle: (row: number, col: number, value: number) => void;
  onPiecePlaced: (cells: CellPos[], pieceId: number) => void;
  onBoardSet: (board: Board) => void;
  onQueueView?: (view: QueueView) => void;
  queue: number[];
  keys: Bindings;
  handling: Handling;
  sidePanel?: ReactNode;
}

export default function TetrisBoard({ board, onCellToggle, onPiecePlaced, onBoardSet, onQueueView, queue, keys, handling, sidePanel }: TetrisBoardProps) {
  const [selectedPaint, setSelectedPaint] = useState<number>(8);

  // click-drag painting: the value set on mousedown is painted onto every
  // cell the cursor passes over until mouseup
  const paintingRef = useRef<number | null>(null);
  useEffect(() => {
    const stop = () => { paintingRef.current = null; };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  // piece flow (same model as solve mode, minus move recording)
  const [queuePos, setQueuePos]         = useState(1);
  const [currentPiece, setCurrentPiece] = useState<number | null>(queue[0] ?? null);
  const [held, setHeld]                 = useState<number | null>(null);
  const [rotation, setRotation]         = useState(0);
  const [pieceRow, setPieceRow]         = useState(0);
  const [pieceCol, setPieceCol]         = useState(() => spawnCol(queue[0]));

  // turn-start snapshot + per-placement history for undo / clear
  const turnStartRef = useRef<EditTurnSnapshot>({ piece: queue[0] ?? null, held: null, queuePos: 1 });
  const historyRef   = useRef<EditHistoryEntry[]>([]);

  // restart the flow whenever the queue is edited
  useEffect(() => {
    setQueuePos(1);
    setCurrentPiece(queue[0] ?? null);
    setHeld(null);
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(queue[0]));
    turnStartRef.current = { piece: queue[0] ?? null, held: null, queuePos: 1 };
    historyRef.current = [];
  }, [queue]);

  // keep the queue sidebar in sync with the real piece flow (incl. holds)
  useEffect(() => {
    onQueueView?.({ current: currentPiece, nextIdx: queuePos });
  }, [currentPiece, queuePos, onQueueView]);

  // global key handling — no need to focus the board. Ignores keys typed
  // into inputs or while a modal is open.
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

  const ghostRow = currentPiece != null
    ? hardDrop(board, currentPiece, rotation, pieceRow, pieceCol)
    : pieceRow;

  const activeCells = currentPiece != null ? getPieceCells(currentPiece, rotation, pieceRow, pieceCol) : [];
  const ghostCells  = currentPiece != null ? getPieceCells(currentPiece, rotation, ghostRow,  pieceCol) : [];
  const activeSet   = new Set(activeCells.map(c => `${c.row},${c.col}`));
  const ghostSet    = new Set(ghostCells.map(c => `${c.row},${c.col}`));

  function handleCellDown(row: number, col: number) {
    const cur = board[row][col];
    const value = cur === selectedPaint ? EMPTY : selectedPaint;
    paintingRef.current = value;
    onCellToggle(row, col, value);
  }

  function handleCellEnter(row: number, col: number) {
    if (paintingRef.current == null) return;
    if (board[row][col] !== paintingRef.current) {
      onCellToggle(row, col, paintingRef.current);
    }
  }

  function shiftPiece(dir: number) {
    if (!currentPiece) return;
    if (isValidPlacement(board, currentPiece, rotation, pieceRow, pieceCol + dir))
      setPieceCol(c => c + dir);
  }

  function rotatePiece(cw: boolean) {
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

    historyRef.current.push({ board: board.map(r => [...r]), ...turnStartRef.current });
    onPiecePlaced(getPieceCells(currentPiece, rotation, landRow, pieceCol), currentPiece);

    let next = queue[queuePos] ?? null;
    let heldAfter = held;
    if (next == null && held != null) {
      // queue exhausted — spawn the held piece
      next = held;
      heldAfter = null;
      setHeld(null);
    }
    turnStartRef.current = { piece: next, held: heldAfter, queuePos: queuePos + 1 };
    setCurrentPiece(next);
    setQueuePos(p => p + 1);
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(next));
  }

  function undoEdit() {
    const h = historyRef.current.pop();
    if (!h) return;
    das.stopAll();
    onBoardSet(h.board.map(r => [...r]));
    setCurrentPiece(h.piece);
    setHeld(h.held);
    setQueuePos(h.queuePos);
    turnStartRef.current = { piece: h.piece, held: h.held, queuePos: h.queuePos };
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(h.piece));
  }

  function clearBoard() {
    historyRef.current.push({ board: board.map(r => [...r]), ...turnStartRef.current });
    das.stopAll();
    onBoardSet(Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(EMPTY)));
    setCurrentPiece(queue[0] ?? null);
    setHeld(null);
    setQueuePos(1);
    turnStartRef.current = { piece: queue[0] ?? null, held: null, queuePos: 1 };
    setRotation(0); setPieceRow(0); setPieceCol(spawnCol(queue[0]));
  }

  function holdPiece() {
    if (!currentPiece) return;
    let incoming: number | null;
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

  function handleKeyDown(e: KeyboardEvent) {
    const k = keySig(e);
    if (k === keys.left || k === keys.right || k === keys.softDrop) {
      e.preventDefault();
      if (e.repeat) return;
      if (k === keys.left)     das.start('left');
      if (k === keys.right)    das.start('right');
      if (k === keys.softDrop) das.start('down');
      return;
    }
    if (e.repeat) return;
    if (k === keys.undo)       { e.preventDefault(); undoEdit();         return; }
    if (k === keys.clearBoard) { e.preventDefault(); clearBoard();       return; }
    if (k === keys.rotateCw)   { e.preventDefault(); rotatePiece(true);  return; }
    if (k === keys.rotateCcw)  { e.preventDefault(); rotatePiece(false); return; }
    if (k === keys.hold)       { e.preventDefault(); holdPiece();        return; }
    if (k === keys.place)      { e.preventDefault(); placePiece();       }
  }

  function handleKeyUp(e: KeyboardEvent) {
    const k = normKey(e.key);
    if (k === baseKey(keys.left))     das.stop('left');
    if (k === baseKey(keys.right))    das.stop('right');
    if (k === baseKey(keys.softDrop)) das.stop('down');
  }

  return (
    <div className="tetris-board-container">
      {/* hold | (toolbar + grid) */}
      <div className="board-layout">
        <div className="board-side-panel left">
          <div className="hold-box">
            <PieceMini pieceId={held} size={12} />
          </div>
          {sidePanel}
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
            ><Eraser className="glyph-icon" /></button>
          </div>
        </div>

        <div className="tetris-grid">
          {/* row 0 is the hidden spawn row; only rows 1-20 are shown */}
          {board.map((row, rowIdx) =>
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
                  className={`cell ${cell ? 'filled' : ''} ${isActive ? 'active-piece' : ''} ${isGhost ? 'ghost-edit' : ''}`}
                  style={{
                    '--cell-color':   pieceColor  ?? 'transparent',
                    '--active-color': activeColor ?? 'transparent',
                    '--ghost-color':  ghostColor  ?? 'transparent',
                    gridColumn: colIdx + 1,
                    gridRow:    rowIdx, // shifted up: hidden row 0
                  } as CSSProperties}
                  onMouseDown={e => { e.preventDefault(); handleCellDown(rowIdx, colIdx); }}
                  onMouseOver={() => handleCellEnter(rowIdx, colIdx)}
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
