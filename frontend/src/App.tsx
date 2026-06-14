import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { usePlonkyProver } from './usePlonkyProver';
import TetrisBoard, { type QueueView } from './components/TetrisBoard';
import ProofPanel from './components/ProofPanel';
import RequirementsModal from './components/RequirementsModal';
import GameBoard from './components/GameBoard';
import QueueEditor from './components/QueueEditor';
import HomePage from './components/HomePage';
import SearchPage from './components/SearchPage';
import ProfilePage from './components/ProfilePage';
import AboutPage from './components/AboutPage';
import AuthModal from './components/AuthModal';
import KeybindingsModal from './components/KeybindingsModal';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { GearIcon, GlassIcon } from './components/icons';
import { boardToUint8, movesToUint8, clearLines, BOARD_COLS, BOARD_ROWS, type Board, type CellPos, type SecretMoves } from './tetrisUtils';
import { emptyLedger, requirementsMet, type Ledger, type Requirements } from './tetrisLedger';
import { loadBindings, saveBindings, loadHandling, saveHandling, type Bindings, type Handling } from './keybindings';
import { api, getToken, setToken, type Puzzle, type User } from './api';

const emptyBoard = (): Board =>
  Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(0));

const REQ_NAMES = ['TSS', 'TSD', 'TST', 'TETRIS', 'PC', 'ATTACK', 'COMBO'];

type View = 'home' | 'search' | 'create' | 'play' | 'profile' | 'about';
type Stage = 'edit' | 'solve';

/** A fetched puzzle plus its frontend-format conversions. */
interface PlayPuzzle extends Puzzle {
  boardRows: Board;
  queueIds: number[];
}

function requirementsProgress(requirements: Requirements, ledger: Ledger): string {
  const counts = [
    ledger.tss, ledger.tsd, ledger.tst, ledger.tetris,
    ledger.pc, ledger.attack, ledger.maxCombo,
  ];
  const parts = requirements
    .slice(0, 7)
    .map((v, i) => (v > 0 ? `${REQ_NAMES[i]} ${counts[i]}/${v}` : null))
    .filter(Boolean);
  if (requirements[7]) parts.push('NO HOLD');
  return parts.length ? parts.join(' · ') : 'no requirements';
}

function App() {
  const { prove, isReady, isProving, error } = usePlonkyProver();

  // index
  const [view, setView] = useState<View>('home');
  const [profileUser, setProfileUser] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!getToken()) return;
    api.me()
      .then(setUser)
      .catch(() => setToken(null)); // stale token
  }, []);

  // close the account dropdown on any outside click
  useEffect(() => {
    if (!showUserMenu) return;
    function onClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showUserMenu]);

  function handleLogout() {
    api.logout().catch(() => {});
    setToken(null);
    setUser(null);
  }

  // create mode
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [queue, setQueue] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [requirements, setRequirements] = useState<Requirements>([0, 0, 0, 0, 0, 0, 0, 0]);
  const [puzzleName, setPuzzleName] = useState('');
  const [stage, setStage] = useState<Stage>('edit');

  // client-side ("secure") proving preference (per-device)
  const [secureProving, setSecureProving] = useState<boolean>(
    () => localStorage.getItem('plonktris-secure-proving') === '1'
  );
  function handleSecureProvingChange(v: boolean) {
    setSecureProving(v);
    localStorage.setItem('plonktris-secure-proving', v ? '1' : '0');
  }

  // server-side fast-proving rate limit hit → offer in-browser proving instead
  const [rateLimited, setRateLimited] = useState(false);

  // warn before leaving during an in-browser proof (it dies if the tab closes)
  const [secureProvingActive, setSecureProvingActive] = useState(false);
  useEffect(() => {
    if (!secureProvingActive) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [secureProvingActive]);

  const [playPuzzle, setPlayPuzzle] = useState<PlayPuzzle | null>(null);

  // solve/play
  const [queueView, setQueueView] = useState<QueueView>({ current: null, nextIdx: 0 });
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const [secretMoves, setSecretMoves] = useState<SecretMoves | null>(null);
  const [proof, setProof] = useState<unknown>(null);
  const [proofError, setProofError] = useState<unknown>(null);

  const [showReqModal, setShowReqModal] = useState(false);
  const [reqsConfirmed, setReqsConfirmed] = useState(false);

  // leaving create while solving resets it back to edit mode
  useEffect(() => {
    if (view !== 'create') {
      setStage('edit');
      setReqsConfirmed(false);
    }
  }, [view]);

  const [keys, setKeys] = useState<Bindings>(loadBindings);
  const [handling, setHandling] = useState<Handling>(loadHandling);
  const [showKeysModal, setShowKeysModal] = useState(false);

  function handleKeysChange(next: Bindings) { setKeys(next); saveBindings(next); }
  function handleHandlingChange(next: Handling) { setHandling(next); saveHandling(next); }

  function resetRunState() {
    setLedger(emptyLedger());
    setSecretMoves(null);
    setProof(null);
    setProofError(null);
  }

  function gotoHome() {
    resetRunState();
    setPlayPuzzle(null);
    setView('home');
  }

  function gotoSearch() {
    resetRunState();
    setPlayPuzzle(null);
    setView('search');
  }

  function gotoCreate() {
    resetRunState();
    setPlayPuzzle(null);
    setView('create');
  }

  function gotoAbout() {
    resetRunState();
    setPlayPuzzle(null);
    setView('about');
  }

  function gotoProfile(username: string) {
    resetRunState();
    setPlayPuzzle(null);
    setProfileUser(username);
    setView('profile');
  }

  function openPlay(puzzle: Puzzle) {
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

  const handleCellToggle = useCallback((row: number, col: number, value: number) => {
    setBoard(prev => {
      const next = prev.map(r => [...r]);
      next[row][col] = value ?? 0;
      return clearLines(next);
    });
  }, []);

  function handleEditPiecePlaced(placedCells: CellPos[], pieceId: number) {
    setBoard(prev => {
      const next = prev.map(r => [...r]);
      for (const { row, col } of placedCells) next[row][col] = pieceId;
      return clearLines(next);
    });
  }

  function handleStartSolving() {
    if (queue.length === 0) return;
    // always start the requirements modal fresh at 0
    setRequirements([0, 0, 0, 0, 0, 0, 0, 0]);
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

  async function runProve(secure: boolean) {
    if (!secretMoves) return;
    // anonymous solves aren't recorded, so skip the prover entirely
    if (view === 'play' && playPuzzle && !user) {
      setProofError(null);
      setProof({ localOnly: true });
      return;
    }
    setProof(null);
    setProofError(null);
    setRateLimited(false);
    // secure proving runs in-browser and dies if the tab closes — guard it
    if (secure) setSecureProvingActive(true);
    try {
      let boardBytes: Uint8Array, queueBytes: Uint8Array, reqBytes: Uint8Array;
      let extra: { token: string | null; puzzleId?: string; name?: string };
      if (view === 'play' && playPuzzle) {
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
      const result = await prove(boardBytes, queueBytes, reqBytes, movesBytes, secure ? 'browser' : 'server', extra);
      // server hit the per-user fast-proving limit → offer secure proving instead
      if (result && (result as { rateLimited?: boolean }).rateLimited) {
        setRateLimited(true);
      } else {
        setProof(result);
      }
    } catch (e) {
      setProofError(e);
    } finally {
      setSecureProvingActive(false);
    }
  }

  function handleProveClick(secure: boolean) {
    if (!secretMoves) return;
    // publishing is gated behind login; anonymous solving is fine (unrecorded)
    if (view === 'create' && !user) {
      setShowAuthModal(true);
      return;
    }
    runProve(secure);
  }

  const activeReqs = view === 'play' ? playPuzzle?.requirements : requirements;
  const reqsDone   = activeReqs ? requirementsMet(ledger, activeReqs) : false;
  const showProgress = view === 'play' || reqsConfirmed;
  const reqSummary = showProgress && activeReqs ? requirementsProgress(activeReqs, ledger) : null;

  return (
    <div className="app">
      <header className="app-header">
        <button className="logo-group" onClick={gotoHome} title="Home">
          <img className="logo-mark" src="/logo.svg" alt="" />
          <span className="logo-word">lonktris</span>
        </button>

        <nav className="view-tabs">
          <button
            className={`stage-tab ${view === 'search' ? 'active' : ''}`}
            onClick={gotoSearch}
          >
            SEARCH
          </button>
          <button
            className={`stage-tab ${view === 'create' ? 'active' : ''}`}
            onClick={gotoCreate}
          >
            CREATE
          </button>
          <button
            className={`stage-tab ${view === 'about' ? 'active' : ''}`}
            onClick={gotoAbout}
          >
            ABOUT
          </button>
        </nav>

        {view === 'play' && playPuzzle && (
          <div className="play-board-title">
            <span className="play-board-name">{playPuzzle.name}</span>
            <span className="play-board-creator">
              by{' '}
              {playPuzzle.creator ? (
                <button className="creator-link" onClick={() => gotoProfile(playPuzzle.creator!)}>
                  {playPuzzle.creator}
                </button>
              ) : 'anonymous'}
            </span>
          </div>
        )}

        <div className="stage-tabs">
          {view === 'create' && (
            stage === 'edit' ? (
              <button
                className="stage-tab"
                onClick={handleStartSolving}
                disabled={queue.length === 0}
              >
                <GlassIcon className="btn-icon" />SOLVE
              </button>
            ) : (
              <button className="stage-tab" onClick={handleBackToEdit}>
                <ArrowLeft className="glyph-icon glyph-lead" />EDIT
              </button>
            )
          )}
          {(view === 'play' || view === 'create') && (
            <button className="keys-open-btn" onClick={() => setShowKeysModal(true)} title="Keybindings">
              <GearIcon className="btn-icon" />
            </button>
          )}

          {user ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                className={`user-name ${showUserMenu ? 'open' : ''}`}
                onClick={() => setShowUserMenu(v => !v)}
                title="Account"
              >
                {user.username}
                <span className="user-caret"><ChevronDown className="glyph-icon" /></span>
              </button>
              {showUserMenu && (
                <div className="user-dropdown">
                  <button
                    className="user-dropdown-item"
                    onClick={() => { setShowUserMenu(false); gotoProfile(user.username); }}
                  >
                    profile
                  </button>
                  <button
                    className="user-dropdown-item"
                    onClick={() => { setShowUserMenu(false); handleLogout(); }}
                  >
                    log out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="login-btn" onClick={() => setShowAuthModal(true)}>
              log in
            </button>
          )}
        </div>
      </header>

      {view === 'home' ? (
        <main className="app-main browse-main">
          <HomePage onPlay={openPlay} onCreator={gotoProfile} />
        </main>
      ) : view === 'about' ? (
        <main className="app-main browse-main">
          <AboutPage onBrowse={gotoHome} onCreate={gotoCreate} />
        </main>
      ) : view === 'search' ? (
        <main className="app-main browse-main">
          <SearchPage onPlay={openPlay} onCreator={gotoProfile} />
        </main>
      ) : view === 'profile' && profileUser ? (
        <main className="app-main browse-main">
          <ProfilePage
            username={profileUser}
            onPlay={openPlay}
            onCreator={gotoProfile}
            isOwner={!!user && user.username.toLowerCase() === profileUser.toLowerCase()}
            secureProving={secureProving}
            onSecureProvingChange={handleSecureProvingChange}
            bindings={keys}
            onBindingsChange={handleKeysChange}
            handling={handling}
            onHandlingChange={handleHandlingChange}
          />
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
                    <GlassIcon className="btn-icon" />solve
                  </button>
                }
              />
            ) : (
              <GameBoard
                key={view === 'play' ? playPuzzle?.id : 'create-solve'}
                initialBoard={view === 'play' && playPuzzle ? playPuzzle.boardRows : board}
                queue={view === 'play' && playPuzzle ? playPuzzle.queueIds : queue}
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
                      allowSecure={secureProving}
                      rateLimited={rateLimited}
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
                          : 'log in to publish your puzzle'}
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
              queue={view === 'play' && playPuzzle ? playPuzzle.queueIds : queue}
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
