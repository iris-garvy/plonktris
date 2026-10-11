import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './App.css';
import HomePage from './components/HomePage';
import SearchPage from './components/SearchPage';
import ProfilePage from './components/ProfilePage';
import AboutPage from './components/AboutPage';
import AuthModal from './components/AuthModal';
import KeybindingsModal from './components/KeybindingsModal';
import PlayView from './components/PlayView';
import CreateView, { type PublishedPuzzle } from './components/CreateView';
import { GearIcon } from './components/icons';
import {
  api, ApiError, errorMessage, getCachedUser, getToken, setSession,
  type Puzzle, type SolveResult, type User,
} from './api';
import { loadBindings, saveBindings, loadHandling, saveHandling, type Bindings, type Handling } from './keybindings';
import { boardToBits, queueToApi } from './game/engine';
import { linkClick, noFocus, profilePath, puzzlePath } from './puzzleInfo';

// ---------------------------------------------------------------------------
// routing: the URL is the source of truth for which view is showing
// ---------------------------------------------------------------------------

type Route =
  | { view: 'home' }
  | { view: 'search' }
  | { view: 'create' }
  | { view: 'about' }
  | { view: 'profile'; username: string }
  | { view: 'play'; id: string };

function parseRoute(path: string): Route | null {
  const pathname = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (pathname === '/') return { view: 'home' };
  if (pathname === '/search') return { view: 'search' };
  if (pathname === '/create') return { view: 'create' };
  if (pathname === '/about') return { view: 'about' };
  const m = pathname.match(/^\/([up])\/([^/]+)$/);
  if (m) {
    let arg: string;
    try { arg = decodeURIComponent(m[2]); } catch { return null; }
    return m[1] === 'u' ? { view: 'profile', username: arg } : { view: 'play', id: arg };
  }
  return null;
}

function initialRoute(): Route {
  const r = parseRoute(window.location.pathname);
  if (r) return r;
  window.history.replaceState(null, '', '/');   // unknown path → home
  return { view: 'home' };
}

const sameUser = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  // bumps on every navigation (remounts the search page so its URL filters are re-read)
  const [navCount, setNavCount] = useState(0);

  // ---- session ----
  const [user, setUser] = useState<User | null>(getCachedUser);
  // false only while we hold a token but don't know whose it is yet
  const [sessionKnown, setSessionKnown] = useState(() => !getToken() || getCachedUser() != null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    api.me()
      .then(u => {
        if (cancelled || getToken() !== token) return;
        setUser(u);
        setSession(token, u);
      })
      .catch(err => {
        if (cancelled || getToken() !== token) return;
        // only a rejected token logs you out — a sleepy/unreachable server shouldn't
        if (err instanceof ApiError && err.status === 401) { setSession(null); setUser(null); }
      })
      .finally(() => { if (!cancelled) setSessionKnown(true); });
    return () => { cancelled = true; };
  }, []);

  const [authModal, setAuthModal] = useState<{ reason: string | null } | null>(null);
  const afterAuthRef = useRef<((u: User) => void) | null>(null);

  const closeAuth = useCallback(() => {
    afterAuthRef.current = null;
    setAuthModal(null);
  }, []);

  function openLogin(reason: string | null = null) {
    afterAuthRef.current = null;
    setAuthModal({ reason });
  }

  /** Runs `then` with the logged-in user — straight away, or right after they log in. */
  function requireAuth(then: (u: User) => void, reason: string) {
    if (user) { then(user); return; }
    afterAuthRef.current = then;
    setAuthModal({ reason });
  }

  function handleAuthed(u: User) {
    setUser(u);
    setSessionKnown(true);
    setAuthModal(null);
    const then = afterAuthRef.current;
    afterAuthRef.current = null;
    then?.(u);
  }

  function handleAuthExpired() {
    setSession(null);
    setUser(null);
  }

  function handleLogout() {
    api.logout().catch(() => {});   // reads the token synchronously, before it's cleared below
    setSession(null);
    setUser(null);
  }

  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showUserMenu) return;
    function onDown(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowUserMenu(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showUserMenu]);

  // ---- settings ----
  const [bindings, setBindings] = useState<Bindings>(loadBindings);
  const [handling, setHandling] = useState<Handling>(loadHandling);
  const [showSettings, setShowSettings] = useState(false);
  function handleBindingsChange(next: Bindings) { setBindings(next); saveBindings(next); }
  function handleHandlingChange(next: Handling) { setHandling(next); saveHandling(next); }

  // ---- the puzzle being played ----
  const [playPuzzle, setPlayPuzzle] = useState<Puzzle | null>(null);
  const [playError, setPlayError] = useState<{ id: string; message: string; notFound: boolean } | null>(null);
  const [playFetch, setPlayFetch] = useState(0);   // bump to refetch
  const [justPublished, setJustPublished] = useState<string | null>(null);

  const playId = route.view === 'play' ? route.id : null;
  const userId = user?.id;
  // (re)load the puzzle on open, on login/logout (solved_by_me), and after a solve (counts)
  useEffect(() => {
    if (playId == null) return;
    let cancelled = false;
    api.getPuzzle(playId)
      .then(p => { if (!cancelled) setPlayPuzzle(p); })
      .catch(err => {
        if (cancelled) return;
        const notFound = err instanceof ApiError && (err.status === 404 || err.status === 400);
        setPlayError({ id: playId, message: errorMessage(err), notFound });
      });
    return () => { cancelled = true; };
  }, [playId, userId, playFetch]);

  const currentPuzzle = playPuzzle && playPuzzle.id === playId ? playPuzzle : null;

  // ---- navigation ----
  const changeRoute = useCallback((r: Route) => {
    setRoute(r);
    setNavCount(c => c + 1);
    setShowUserMenu(false);
    setPlayError(null);   // a fresh attempt at loading whatever puzzle comes next
    closeAuth();
    // the share banner only shows on the puzzle you just published
    setJustPublished(id => (r.view === 'play' && r.id === id ? id : null));
  }, [closeAuth]);

  const navigate = useCallback((path: string) => {
    if (path !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', path);
    }
    changeRoute(parseRoute(path) ?? { view: 'home' });
    window.scrollTo(0, 0);
  }, [changeRoute]);

  useEffect(() => {
    const onPop = () => {
      const r = parseRoute(window.location.pathname);
      if (!r) window.history.replaceState(null, '', '/');
      changeRoute(r ?? { view: 'home' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [changeRoute]);

  function openPuzzle(p: Puzzle) {
    setPlayPuzzle(p);   // show it right away; the effect above refreshes it
    navigate(puzzlePath(p.id));
  }
  function gotoProfile(username: string) { navigate(profilePath(username)); }

  function handleSolved(id: string, res: SolveResult) {
    setPlayPuzzle(prev => (prev && prev.id === id
      ? { ...prev, solve_count: res.solve_count, solved_by_me: prev.solved_by_me || res.new_solve }
      : prev));
    setPlayFetch(n => n + 1);
  }

  function handlePublished(p: PublishedPuzzle) {
    setPlayPuzzle({
      id: p.id,
      name: p.name,
      creator: p.creator,
      board: boardToBits(p.spec.board),
      queue: queueToApi(p.spec.queue),
      requirements: [...p.spec.requirements],
      num_pieces: p.spec.queue.length,
      solve_count: 0,
      attempt_count: 0,
      solved_by_me: false,
    });
    setJustPublished(p.id);
    navigate(puzzlePath(p.id));
  }

  // ---- document title ----
  const puzzleName = currentPuzzle?.name;
  useEffect(() => {
    let t = 'plonktris';
    if (route.view === 'play' && puzzleName) t = `${puzzleName} · plonktris`;
    else if (route.view === 'profile') t = `${route.username} · plonktris`;
    else if (route.view !== 'home' && route.view !== 'play') t = `${route.view} · plonktris`;
    document.title = t;
  }, [route, puzzleName]);

  const modalOpen = authModal != null || showSettings;
  const viewerKey = userId ?? 'anon';

  // ---- views ----
  let main;
  switch (route.view) {
    case 'home':
      main = <HomePage key={viewerKey} onPlay={openPuzzle} onCreator={gotoProfile} />;
      break;
    case 'search':
      main = (
        <SearchPage
          key={navCount}
          onPlay={openPuzzle}
          onCreator={gotoProfile}
          loggedIn={!!user}
          viewerKey={viewerKey}
        />
      );
      break;
    case 'about':
      main = (
        <AboutPage
          onBrowse={() => navigate('/')}
          onCreate={() => navigate('/create')}
          onOpenSettings={() => setShowSettings(true)}
        />
      );
      break;
    case 'profile':
      main = (
        <ProfilePage
          key={`${route.username}|${viewerKey}`}
          username={route.username}
          onPlay={openPuzzle}
          onCreator={gotoProfile}
          isOwner={!!user && sameUser(user.username, route.username)}
          onOpenSettings={() => setShowSettings(true)}
          onCreate={() => navigate('/create')}
        />
      );
      break;
    case 'create':
      main = (
        <CreateView
          user={user}
          bindings={bindings}
          handling={handling}
          inputBlocked={modalOpen}
          requireAuth={requireAuth}
          onAuthExpired={handleAuthExpired}
          onPublished={handlePublished}
        />
      );
      break;
    case 'play':
      if (currentPuzzle) {
        main = (
          <PlayView
            key={currentPuzzle.id}
            puzzle={currentPuzzle}
            user={user}
            bindings={bindings}
            handling={handling}
            inputBlocked={modalOpen}
            justPublished={justPublished === currentPuzzle.id
              && !!user && user.username.toLowerCase() === currentPuzzle.creator?.toLowerCase()}
            onLogin={() => openLogin('log in to save this solve')}
            onAuthExpired={handleAuthExpired}
            onSolved={handleSolved}
            onOpenPuzzle={openPuzzle}
            onNavigate={navigate}
          />
        );
      } else if (playError && playError.id === route.id) {
        main = (
          <div className="view-status">
            <div className="browse-error">
              {playError.notFound ? "this puzzle doesn't exist (or was removed)" : `couldn't load this puzzle: ${playError.message}`}
            </div>
            <div className="view-status-actions">
              {!playError.notFound && (
                <button className="ghost-btn" onClick={() => { setPlayError(null); setPlayFetch(n => n + 1); }}>
                  try again
                </button>
              )}
              <a className="ghost-btn" href="/" onClick={e => linkClick(e, () => navigate('/'))}>browse puzzles</a>
            </div>
          </div>
        );
      } else {
        main = <div className="view-status">loading puzzle…</div>;
      }
      break;
  }

  const tab = (path: string, label: string, active: boolean) => (
    <a
      href={path}
      className={`stage-tab${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={e => linkClick(e, () => navigate(path))}
    >
      {label}
    </a>
  );

  return (
    <div className="app">
      <header className="app-header">
        <a className="logo-group" href="/" title="home" onClick={e => linkClick(e, () => navigate('/'))}>
          <img className="logo-mark" src="/logo.svg" alt="" />
          <span className="logo-word">lonktris</span>
        </a>

        <nav className="view-tabs">
          {tab('/search', 'search', route.view === 'search')}
          {tab('/create', 'create', route.view === 'create')}
          {tab('/about', 'about', route.view === 'about')}
        </nav>

        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            onMouseDown={noFocus}
            onClick={() => setShowSettings(true)}
            title="settings — controls & handling"
            aria-label="settings"
          >
            <GearIcon className="btn-icon" />
          </button>

          {user ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className={`user-name ${showUserMenu ? 'open' : ''}`}
                onMouseDown={noFocus}
                onClick={() => setShowUserMenu(v => !v)}
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
                title="account"
              >
                {user.username}
                <span className="user-caret"><ChevronDown className="glyph-icon" /></span>
              </button>
              {showUserMenu && (
                <div className="user-dropdown" role="menu">
                  <a
                    className="user-dropdown-item"
                    role="menuitem"
                    href={profilePath(user.username)}
                    onClick={e => linkClick(e, () => gotoProfile(user.username))}
                  >
                    profile
                  </a>
                  <button
                    type="button"
                    className="user-dropdown-item"
                    role="menuitem"
                    onClick={() => { setShowUserMenu(false); handleLogout(); }}
                  >
                    log out
                  </button>
                </div>
              )}
            </div>
          ) : sessionKnown ? (
            <button type="button" className="login-btn" onMouseDown={noFocus} onClick={() => openLogin()}>
              log in
            </button>
          ) : (
            <span className="login-btn placeholder" aria-hidden="true">log in</span>
          )}
        </div>
      </header>

      <main className={`app-main view-${route.view}`}>{main}</main>

      {authModal && (
        <AuthModal reason={authModal.reason} onAuthed={handleAuthed} onClose={closeAuth} />
      )}

      {showSettings && (
        <KeybindingsModal
          bindings={bindings}
          onChange={handleBindingsChange}
          handling={handling}
          onHandlingChange={handleHandlingChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
