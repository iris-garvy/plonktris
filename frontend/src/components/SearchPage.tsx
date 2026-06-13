import { useState, useEffect } from 'react';
import { api, type Puzzle, type PuzzleFilters, type ReqFilter } from '../api';
import PuzzleCard from './PuzzleCard';
import './BrowsePage.css';
import './SearchPage.css';

interface SearchPageProps {
  onPlay: (puzzle: Puzzle) => void;
  onCreator?: (username: string) => void;
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

export default function SearchPage({ onPlay, onCreator }: SearchPageProps) {
  const [q, setQ] = useState('');
  const [minPieces, setMinPieces] = useState('');
  const [maxPieces, setMaxPieces] = useState('');
  const [unsolved, setUnsolved] = useState(false);
  const [reqs, setReqs] = useState<ReqFilter[]>([]);
  const [reqsOpen, setReqsOpen] = useState(false);
  const [sort, setSort] = useState<SortOption>('new');

  const [results, setResults] = useState<Puzzle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleReq(key: ReqFilter) {
    setReqs(prev => prev.includes(key) ? prev.filter(r => r !== key) : [...prev, key]);
  }

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

      setError(null);
      api.listPuzzles(filters)
        .then(({ puzzles }) => { if (!cancelled) setResults(puzzles); })
        .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, minPieces, maxPieces, unsolved, reqs, sort]);

  return (
    <div className="search-page">
      <div className="search-bar">
        <input
          className="search-input"
          type="text"
          placeholder="search puzzles by name…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
      </div>

      <div className="search-filters">
        <label className="filter">
          <span className="filter-label">pieces</span>
          <input
            className="filter-num" type="number" min={1} max={25} placeholder="min"
            value={minPieces} onChange={e => setMinPieces(e.target.value)}
          />
          <span className="filter-dash">–</span>
          <input
            className="filter-num" type="number" min={1} max={25} placeholder="max"
            value={maxPieces} onChange={e => setMaxPieces(e.target.value)}
          />
        </label>

        <div className="filter reqs-filter">
          <span className="filter-label">requirements</span>
          <button
            type="button"
            className="reqs-toggle"
            onClick={() => setReqsOpen(o => !o)}
          >
            {reqs.length === 0 ? 'any' : `${reqs.length} selected`} ▾
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
          <select className="filter-select" value={sort} onChange={e => setSort(e.target.value as SortOption)}>
            <option value="new">newest</option>
            <option value="solves">most solved</option>
          </select>
        </label>

        <label className="filter checkbox-filter">
          <span className="filter-label">unsolved</span>
          <input type="checkbox" checked={unsolved} onChange={e => setUnsolved(e.target.checked)} />
        </label>
      </div>

      {error ? (
        <div className="browse-status"><div className="browse-error">{error}</div></div>
      ) : results == null ? (
        <div className="browse-status">searching…</div>
      ) : results.length === 0 ? (
        <div className="browse-status">no puzzles match your filters</div>
      ) : (
        <div className="browse-grid compact">
          {results.map(p => (
            <PuzzleCard key={p.id} puzzle={p} onPlay={onPlay} onCreator={onCreator} compact />
          ))}
        </div>
      )}
    </div>
  );
}
