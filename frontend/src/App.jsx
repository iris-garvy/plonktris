import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { usePlonkyProver } from './usePlonkyProver';
import TetrisBoard from './components/TetrisBoard';
import ProofPanel from './components/ProofPanel';
import RequirementsModal from './components/RequirementsModal';
import GameBoard from './components/GameBoard';
import QueueEditor from './components/QueueEditor';
import BrowsePage from './components/BrowsePage';
import AuthModal from './components/AuthModal';
import KeybindingsModal from './components/KeybindingsModal';
import { boardToUint8, movesToUint8, clearLines, BOARD_COLS, BOARD_ROWS } from './tetrisUtils';
import { emptyLedger, requirementsMet } from './tetrisLedger';
import { loadBindings, saveBindings, loadHandling, saveHandling } from './keybindings';
import { api, getToken, setToken } from './api';

const emptyBoard = () =>
  Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(0));

const REQ_NAMES = ['TSS', 'TSD', 'TST', 'TETRIS', 'PC', 'ATTACK', 'COMBO'];

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

  // index
  const [view, setView] = useState('browse');

  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    api.me()
      .then(setUser)
      .catch(() => setToken(null)); // stale token
  }, []);

  function handleLogout() {
    api.logout().catch(() => {});
    setToken(null);
    setUser(null);
  }

  //create mode
  const [board, setBoard] = useState(emptyBoard);
  const [queue, setQueue] = useState([1, 2, 3, 4, 5, 6, 7]);
  const [requirements, setRequirements] = useState([0, 0, 0, 0, 0, 0, 0, 0]);
  const [puzzleName, setPuzzleName] = useState('');
  const [stage, setStage] = useState('edit'); // 'edit' | 'solve' within create

  const [playPuzzle, setPlayPuzzle] = useState(null);

  //solve/play
  const [queueView, setQueueView] = useState({ current: null, nextIdx: 0 });
  const [ledger, setLedger] = useState(emptyLedger);
  const [secretMoves, setSecretMoves] = useState(null);
  const [proof, setProof] = useState(null);
  const [proofError, setProofError] = useState(null);

  const [showReqModal, setShowReqModal] = useState(false);
  const [reqsConfirmed, setReqsConfirmed] = useState(false);

  const [keys, setKeys] = useState(loadBindings);
  const [handling, setHandling] = useState(loadHandling);
  const [showKeysModal, setShowKeysModal] = useState(false);

  function handleKeysChange(next) { setKeys(next); saveBindings(next); }
  function handleHandlingChange(next) { setHandling(next); saveHandling(next); }

  function resetRunState() {
    setLedger(emptyLedger());
    setSecretMoves(null);
    setProof(null);
    setProofError(null);
  }

  function gotoBrowse() {
    resetRunState();
    setPlayPuzzle(null);
    setView('browse');
  }

  function gotoCreate() {
    resetRunState();
    setPlayPuzzle(null);
    setView('create');
  }

  function openPlay(puzzle) {
    // server formats → frontend formats: occupancy bits → gray cells,
    // prover piece ids 0-6 → frontend ids 1-7
    const rows = Array.from({ length: BOARD_ROWS }, (_, r) =>
      Array.from({ length: BOARD_COLS }, (_, c) =>
        puzzle.board[r * BOARD_COLS + c] ? 8 : 0
      )
    );
    setPlayPuzzle({
      ...puzzle,
      boardRows: rows,
      queueIds: puzzle.queue.map(id => id + 1),
    });
    resetRunState();
    setView('play');
  }

  const handleCellToggle = useCallback((row, col, value) => {
    setBoard(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = value ?? 0;
      return clearLines(next);
    });
  }, []);

  function handleEditPiecePlaced(placedCells, pieceId) {
    setBoard(prev => {
      const next = prev.map(r => [...r]);
      for (const { row, col } of placedCells) next[row][col] = pieceId;
      return clearLines(next);
    });
  }

  function handleStartSolving() {
    if (queue.length === 0) return;
    setShowReqModal(true);
  }

  function handleReqModalSubmit() {
    setShowReqModal(false);
    setReqsConfirmed(true);
    resetRunState();
    setStage('solve');
  }

  function handleBackToEdit() {
    resetRunState();
    setReqsConfirmed(false);
    setShowReqModal(false);
    setStage('edit');
  }

  async function runProve() {
    if (!secretMoves) return;
    setProof(null);
    setProofError(null);
    try {
      let boardBytes, queueBytes, reqBytes, extra;
      if (view === 'play') {
        boardBytes = new Uint8Array(playPuzzle.board);
        queueBytes = new Uint8Array(playPuzzle.queue);
        reqBytes   = new Uint8Array(playPuzzle.requirements);
        extra = { token: getToken(), puzzleId: playPuzzle.id };
      } else {
        boardBytes = boardToUint8(board);
        queueBytes = new Uint8Array(queue.map(id => id - 1));
        reqBytes   = new Uint8Array(requirements);
        extra = { token: getToken(), name: puzzleName || 'untitled' };
      }
      const movesBytes = movesToUint8(secretMoves);
      const result = await prove(boardBytes, queueBytes, reqBytes, movesBytes, 'server', extra);
      setProof(result);
    } catch (e) {
      setProofError(e);
    }
  }

  function handleProveClick() {
    if (!secretMoves) return;
    runProve();
  }

  const activeReqs = view === 'play' ? playPuzzle?.requirements : requirements;
  const reqsDone   = activeReqs ? requirementsMet(ledger, activeReqs) : false;
  const showProgress = view === 'play' || reqsConfirmed;
  const reqSummary = showProgress && activeReqs ? requirementsProgress(activeReqs, ledger) : null;

  const inGame = view === 'create' || view === 'play';
  const solving = view === 'play' || (view === 'create' && stage === 'solve');

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-group">
          <span className="logo-bracket">[</span>
          <span className="logo-text">PLONKTRIS</span>
          <span className="logo-bracket">]</span>
        </div>

        <nav className="view-tabs">
          <button
            className={`stage-tab ${view === 'browse' ? 'active' : ''}`}
            onClick={gotoBrowse}
          >
            BROWSE
          </button>
          <button
            className={`stage-tab ${view === 'create' ? 'active' : ''}`}
            onClick={gotoCreate}
          >
            CREATE
          </button>
        </nav>

        <div className="stage-tabs">
          {view === 'create' && (
            stage === 'edit' ? (
              <button
                className="stage-tab"
                onClick={handleStartSolving}
                disabled={queue.length === 0}
              >
                ▶ SOLVE
              </button>
            ) : (
              <button className="stage-tab" onClick={handleBackToEdit}>
                ← EDIT
              </button>
            )
          )}
          {view === 'play' && playPuzzle && (
            <span className="play-title">{playPuzzle.name} · by {playPuzzle.creator ?? 'anonymous'}</span>
          )}

          <button className="keys-open-btn" onClick={() => setShowKeysModal(true)} title="Keybindings">
            ⌨
          </button>

          {user ? (
            <div className="user-box">
              <span className="user-name">{user.username}</span>
              <button className="user-logout" onClick={handleLogout} title="Log out">✕</button>
            </div>
          ) : (
            <button className="login-btn" onClick={() => setShowAuthModal(true)}>
              log in
            </button>
          )}
        </div>
      </header>

      {view === 'browse' ? (
        <main className="app-main browse-main">
          <BrowsePage onPlay={openPlay} />
        </main>
      ) : (
        <main className="app-main">
          {/* LEFT (spacer keeps the board centered) */}
          <aside className="sidebar sidebar-left" />

          {/* CENTER: board (action block renders under the hold box) */}
          <section className="board-section">
            {view === 'create' && stage === 'edit' ? (
              <TetrisBoard
                board={board}
                onCellToggle={handleCellToggle}
                onPiecePlaced={handleEditPiecePlaced}
                onBoardSet={setBoard}
                onQueueView={setQueueView}
                queue={queue}
                keys={keys}
                handling={handling}
                sidePanel={
                  <button
                    className="start-solving-btn"
                    onClick={handleStartSolving}
                    disabled={queue.length === 0}
                  >
                    ▶ solve
                  </button>
                }
              />
            ) : (
              <GameBoard
                key={view === 'play' ? playPuzzle.id : 'create-solve'}
                initialBoard={view === 'play' ? playPuzzle.boardRows : board}
                queue={view === 'play' ? playPuzzle.queueIds : queue}
                onComplete={setSecretMoves}
                onQueueView={setQueueView}
                onLedger={setLedger}
                reqText={reqSummary}
                reqsDone={reqsDone}
                keys={keys}
                handling={handling}
                sidePanel={
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
                        conditions not met — undo and try again
                      </div>
                    )}
                    {secretMoves && reqsDone && !user && (
                      <div className="solve-hint">
                        {view === 'play'
                          ? 'anonymous — log in to record your solve'
                          : 'publishing anonymously — log in to claim your puzzle'}
                      </div>
                    )}
                  </>
                }
              />
            )}
          </section>

          {/* RIGHT: the queue */}
          <aside className="sidebar sidebar-right">
            <QueueEditor
              queue={view === 'play' ? playPuzzle.queueIds : queue}
              onQueueChange={view === 'create' && stage === 'edit' ? setQueue : undefined}
              nextIdx={queueView.nextIdx}
            />
          </aside>
        </main>
      )}

      {showAuthModal && (
        <AuthModal
          onAuthed={setUser}
          onClose={() => setShowAuthModal(false)}
        />
      )}

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
          name={puzzleName}
          onNameChange={setPuzzleName}
          onSubmit={handleReqModalSubmit}
          onCancel={() => setShowReqModal(false)}
        />
      )}
    </div>
  );
}

export default App;
