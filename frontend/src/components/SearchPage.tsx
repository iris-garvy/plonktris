import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { api, errorMessage, type Puzzle, type PuzzleFilters, type ReqFilter } from '../api';
import { MAX_QUEUE } from '../puzzleInfo';
import PuzzleCard from './PuzzleCard';
import './BrowsePage.css';
import './SearchPage.css';

interface SearchPageProps {
  onPlay: (puzzle: Puzzle) => void;
  onCreator?: (username: string) => void;
  /** logged in: offers "hide ones I've solved" */
  loggedIn: boolean;
  /** changes when the viewer logs in/out, so `solved_by_me` gets refreshed */
  viewerKey: string;
}

type SortOption = 'new' | 'solves';

const REQ_OPTIONS: { key: ReqFilter; label: string }[] = [
  { key: 'tspin',  label: 'T-Spin' },
  { key: 'tetris', label: 'Tetris' },
  { key: 'pc',     label: 'Perfect Clear' },
  { key: 'attack', label: 'Attack' },
  { key: 'combo',  label: 'Combo' },
  { key: 'nohold', label: 'No Hold' },
];
const REQ_KEYS = new Set<string>(REQ_OPTIONS.map(o => o.key));

interface SearchState {
  q: string;
  minPieces: string;
  maxPieces: string;
  unsolved: boolean;
  hideMine: boolean;
  reqs: ReqFilter[];
  sort: SortOption;
}

// filters live in the URL (/search?q=…&reqs=tspin), so back/forward and refresh keep them
function readUrl(): SearchState {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') ?? '',
    minPieces: p.get('min') ?? '',
    maxPieces: p.get('max') ?? '',
    unsolved: p.get('unsolved') === '1',
    hideMine: p.get('hide_solved') === '1',
    reqs: (p.get('reqs') ?? '').split(',').filter((r): r is ReqFilter => REQ_KEYS.has(r)),
    sort: p.get('sort') === 'solves' ? 'solves' : 'new',
  };
}

function writeUrl(s: SearchState) {
  const p = new URLSearchParams();
  if (s.q.trim()) p.set('q', s.q.trim());
  if (s.minPieces) p.set('min', s.minPieces);
  if (s.maxPieces) p.set('max', s.maxPieces);
  if (s.unsolved) p.set('unsolved', '1');
  if (s.hideMine) p.set('hide_solved', '1');
  if (s.reqs.length) p.set('reqs', s.reqs.join(','));
  if (s.sort !== 'new') p.set('sort', s.sort);
  const qs = p.toString();
  const next = `/search${qs ? `?${qs}` : ''}`;
  if (window.location.pathname === '/search' && window.location.pathname + window.location.search !== next) {
    window.history.replaceState(window.history.state, '', next);
  }
}

export default function SearchPage({ onPlay, onCreator, loggedIn, viewerKey }: SearchPageProps) {
  const [state, setState] = useState<SearchState>(readUrl);
  const { q, minPieces, maxPieces, unsolved, hideMine, reqs, sort } = state;
  const [reqsOpen, setReqsOpen] = useState(false);

  const [results, setResults] = useState<Puzzle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(patch: Partial<SearchState>) {
    setState(prev => ({ ...prev, ...patch }));
  }

  function toggleReq(key: ReqFilter) {
    update({ reqs: reqs.includes(key) ? reqs.filter(r => r !== key) : [...reqs, key] });
  }

  useEffect(() => { writeUrl(state); }, [state]);

  // debounce so typing / nudging numbers doesn't hammer the server
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      const filters: PuzzleFilters = { sort };
      if (q.trim()) filters.q = q;
      const min = parseInt(minPieces, 10);
      const max = parseInt(maxPieces, 10);
      if (!isNaN(min)) filters.min_pieces = min;
      if (!isNaN(max)) filters.max_pieces = max;
      if (unsolved) filters.solved = 'unsolved';
      if (reqs.length) filters.reqs = reqs;

      api.listPuzzles(filters)
        .then(({ puzzles }) => { if (!cancelled) { setError(null); setResults(puzzles); } })
        .catch(err => { if (!cancelled) setError(errorMessage(err)); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, minPieces, maxPieces, unsolved, reqs, sort, viewerKey]);

  const shown = results && loggedIn && hideMine ? results.filter(p => !p.solved_by_me) : results;

  return (
    <div className="search-page">
      <div className="search-bar">
        <input
          className="search-input"
          type="search"
          placeholder="search puzzles by name…"
          value={q}
          onChange={e => update({ q: e.target.value })}
          autoFocus
        />
      </div>

      <div className="search-filters">
        <label className="filter">
          <span className="filter-label">pieces</span>
          <input
            className="filter-num" type="number" min={1} max={MAX_QUEUE} placeholder="min"
            value={minPieces} onChange={e => update({ minPieces: e.target.value })}
          />
          <span className="filter-dash">–</span>
          <input
            className="filter-num" type="number" min={1} max={MAX_QUEUE} placeholder="max"
            value={maxPieces} onChange={e => update({ maxPieces: e.target.value })}
          />
        </label>

        <div className="filter reqs-filter">
          <span className="filter-label">requirements</span>
          <button
            type="button"
            className="reqs-toggle"
            onClick={() => setReqsOpen(o => !o)}
            aria-expanded={reqsOpen}
          >
            {reqs.length === 0 ? 'any' : `${reqs.length} selected`}<ChevronDown className="glyph-icon glyph-trail" />
          </button>
          {reqsOpen && (
            <>
              <div className="reqs-backdrop" onClick={() => setReqsOpen(false)} />
              <div className="reqs-menu">
                {REQ_OPTIONS.map(({ key, label }) => (
                  <label key={key} className="reqs-option">
                    <input
                      type="checkbox"
                      checked={reqs.includes(key)}
                      onChange={() => toggleReq(key)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <label className="filter">
          <span className="filter-label">sort</span>
          <select className="filter-select" value={sort} onChange={e => update({ sort: e.target.value as SortOption })}>
            <option value="new">newest</option>
            <option value="solves">most solved</option>
          </select>
        </label>

        <label className="filter checkbox-filter" title="puzzles nobody has solved yet">
          <span className="filter-label">unsolved by anyone</span>
          <input type="checkbox" checked={unsolved} onChange={e => update({ unsolved: e.target.checked })} />
        </label>

        {loggedIn && (
          <label className="filter checkbox-filter">
            <span className="filter-label">hide ones i've solved</span>
            <input type="checkbox" checked={hideMine} onChange={e => update({ hideMine: e.target.checked })} />
          </label>
        )}
      </div>

      {error ? (
        <div className="browse-status"><div className="browse-error">{error}</div></div>
      ) : shown == null ? (
        <div className="browse-status">searching…</div>
      ) : shown.length === 0 ? (
        <div className="browse-status">no puzzles match your filters</div>
      ) : (
        <div className="browse-grid compact">
          {shown.map(p => (
            <PuzzleCard key={p.id} puzzle={p} onPlay={onPlay} onCreator={onCreator} compact />
          ))}
        </div>
      )}
    </div>
  );
}
