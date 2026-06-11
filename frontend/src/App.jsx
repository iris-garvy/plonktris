import { useState, useCallback } from 'react';
import './App.css';
import { usePlonkyProver } from './usePlonkyProver';
import TetrisBoard from './components/TetrisBoard';
import ProofPanel from './components/ProofPanel';
import RequirementsModal from './components/RequirementsModal';
import GameBoard from './components/GameBoard';
import QueueEditor from './components/QueueEditor';
import { boardToUint8, movesToUint8, clearLines, BOARD_COLS, BOARD_ROWS } from './tetrisUtils';
import { emptyLedger, requirementsMet } from './tetrisLedger';
import KeybindingsModal from './components/KeybindingsModal';
import { loadBindings, saveBindings, loadHandling, saveHandling } from './keybindings';

const emptyBoard = () =>
  Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(0));

const REQ_NAMES = ['TSS', 'TSD', 'TST', 'TETRIS', 'PC', 'ATTACK', 'COMBO'];

// live progress against the requirements, e.g. "TSD 1/2 · PC 0/1 · NO HOLD ✓"
function requirementsProgress(requirements, ledger) {
  const counts = [
    ledger.tss, ledger.tsd, ledger.tst, ledger.tetris,
    ledger.pc, ledger.attack, ledger.maxCombo,
  ];
  const parts = requirements
    .slice(0, 7)
    .map((v, i) => (v > 0 ? `${REQ_NAMES[i]} ${counts[i]}/${v}` : null))
    .filter(Boolean);
  if (requirements[7]) parts.push(ledger.heldUsed ? 'NO HOLD ✗' : 'NO HOLD ✓');
  return parts.length ? parts.join(' · ') : 'no requirements';
}

function App() {
  const { prove, isReady, isProving, error } = usePlonkyProver();

  const [board, setBoard] = useState(emptyBoard);
  const [queue, setQueue] = useState([1, 1, 1, 1, 2]);
  const [requirements, setRequirements] = useState([0, 0, 0, 0, 0, 0, 0, 0]);

  // live piece-flow view reported by whichever board is active (incl. holds)
  const [queueView, setQueueView] = useState({ current: null, nextIdx: 0 });

  // frontend mirror of the circuit's ledger, reported by GameBoard each lock
  const [ledger, setLedger] = useState(emptyLedger);

  const [stage, setStage]             = useState('edit');
  const [secretMoves, setSecretMoves] = useState(null);
  const [proof, setProof]             = useState(null);
  const [proofError, setProofError]   = useState(null);

  // requirements are entered once, in a popup, at first prove
  const [showReqModal, setShowReqModal]   = useState(false);
  const [reqsConfirmed, setReqsConfirmed] = useState(false);

  // keybindings + handling (persisted to localStorage)
  const [keys, setKeys] = useState(loadBindings);
  const [handling, setHandling] = useState(loadHandling);
  const [showKeysModal, setShowKeysModal] = useState(false);

  function handleKeysChange(next) {
    setKeys(next);
    saveBindings(next);
  }

  function handleHandlingChange(next) {
    setHandling(next);
    saveHandling(next);
  }

  // ── edit board cell paint ──
  const handleCellToggle = useCallback((row, col, value) => {
    setBoard(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = value ?? 0;
      return clearLines(next);
    });
  }, []);

  // ── edit piece placement (called from TetrisBoard after hard-drop) ──
  function handleEditPiecePlaced(placedCells, pieceId) {
    setBoard(prev => {
      const next = prev.map(r => [...r]);
      for (const { row, col } of placedCells) next[row][col] = pieceId;
      return clearLines(next);
    });
  }

  function handleQueueChange(newQueue) {
    setQueue(newQueue);
  }

  // ── stage transitions ──
  // requirements are set in a popup before entering solve mode
  function handleStartSolving() {
    if (queue.length === 0) return;
    setShowReqModal(true);
  }

  function enterSolveMode() {
    setLedger(emptyLedger());
    setSecretMoves(null);
    setProof(null);
    setProofError(null);
    setStage('play');
  }

  function handleBackToEdit() {
    setSecretMoves(null);
    setProof(null);
    setProofError(null);
    setReqsConfirmed(false);
    setShowReqModal(false);
    setStage('edit');
  }

  function handleMovesComplete(moves) {
    setSecretMoves(moves);
  }

  // ── proving ──
  async function runProve(reqs) {
    if (!secretMoves) return;
    setProof(null);
    setProofError(null);
    try {
      const boardBytes = boardToUint8(board);
      const queueBytes = new Uint8Array(queue.map(id => id - 1));
      const reqBytes   = new Uint8Array(reqs);
      const movesBytes = movesToUint8(secretMoves);
      const result = await prove(boardBytes, queueBytes, reqBytes, movesBytes, 'server');
      setProof(result);
    } catch (e) {
      setProofError(e);
    }
  }

  function handleProveClick() {
    if (!secretMoves) return;
    runProve(requirements);
  }

  function handleReqModalSubmit() {
    setShowReqModal(false);
    setReqsConfirmed(true);
    enterSolveMode();
  }

  const reqSummary = reqsConfirmed ? requirementsProgress(requirements, ledger) : null;
  const reqsDone   = requirementsMet(ledger, requirements);

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-group">
          <span className="logo-bracket">[</span>
          <span className="logo-text">PLONKTRIS</span>
          <span className="logo-bracket">]</span>
        </div>
        <div className="header-sub">zero-knowledge tetris puzzle prover</div>

        <div className="stage-tabs">
          <button
            className={`stage-tab ${stage === 'edit' ? 'active' : ''}`}
            onClick={() => stage === 'play' && handleBackToEdit()}
          >
            01 EDIT
          </button>
          <span className="stage-sep">→</span>
          <button
            className={`stage-tab ${stage === 'play' ? 'active' : ''}`}
            onClick={() => stage === 'edit' && handleStartSolving()}
            disabled={queue.length === 0}
          >
            02 SOLVE
          </button>
          <button className="keys-open-btn" onClick={() => setShowKeysModal(true)} title="Keybindings">
            ⌨
          </button>
        </div>
      </header>

      <main className="app-main">
        {/* LEFT (spacer keeps the board centered) */}
        <aside className="sidebar sidebar-left" />

        {/* CENTER: board */}
        <section className="board-section">
          {stage === 'edit' ? (
            <TetrisBoard
              board={board}
              onCellToggle={handleCellToggle}
              onPiecePlaced={handleEditPiecePlaced}
              onQueueView={setQueueView}
              queue={queue}
              keys={keys}
              handling={handling}
            />
          ) : (
            <GameBoard
              initialBoard={board}
              queue={queue}
              onComplete={handleMovesComplete}
              onQueueView={setQueueView}
              onLedger={setLedger}
              reqText={reqSummary}
              reqsDone={reqsDone}
              keys={keys}
              handling={handling}
            />
          )}
        </section>

        {/* RIGHT: queue (always) + proof panel (solve mode) */}
        <aside className="sidebar sidebar-right">
          <QueueEditor
            queue={queue}
            onQueueChange={stage === 'edit' ? handleQueueChange : undefined}
            currentPiece={queueView.current}
            nextIdx={queueView.nextIdx}
          />
          <div className="right-proof">
            {stage === 'edit' ? (
              <button
                className="start-solving-btn"
                onClick={handleStartSolving}
                disabled={queue.length === 0}
              >
                ▶ solve
              </button>
            ) : (
              <>
                <ProofPanel
                  isReady={isReady}
                  isProving={isProving}
                  error={error || proofError}
                  proof={proof}
                  onProve={handleProveClick}
                  disabled={!secretMoves || !reqsDone}
                />
                {secretMoves && !reqsDone && (
                  <div className="solve-hint">
                    conditions not met — edit and try again
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </main>

      {showKeysModal && (
        <KeybindingsModal
          bindings={keys}
          onChange={handleKeysChange}
          handling={handling}
          onHandlingChange={handleHandlingChange}
          onClose={() => setShowKeysModal(false)}
        />
      )}

      {showReqModal && (
        <RequirementsModal
          requirements={requirements}
          onChange={setRequirements}
          onSubmit={handleReqModalSubmit}
          onCancel={() => setShowReqModal(false)}
        />
      )}
    </div>
  );
}

export default App;
