import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { api, type Puzzle, type SiteStats, type LeaderEntry } from '../api';
import PuzzleCard from './PuzzleCard';
import './BrowsePage.css';
import './HomePage.css';

interface HomePageProps {
  onPlay: (puzzle: Puzzle) => void;
  onCreator?: (username: string) => void;
}

interface HomeData {
  stats: SiteStats;
  leaders: LeaderEntry[];
  featured: Puzzle[];
  unsolved: Puzzle[];
  tspin: Puzzle[];
  pc: Puzzle[];
  attack: Puzzle[];
}

function Rail({
  title, hint, puzzles, onPlay, onCreator,
}: {
  title: string;
  hint?: string;
  puzzles: Puzzle[];
  onPlay: (p: Puzzle) => void;
  onCreator?: (u: string) => void;
}) {
  if (puzzles.length === 0) return null;
  return (
    <section className="home-rail">
      <div className="home-rail-head">
        <span className="home-rail-title">{title}</span>
        {hint && <span className="home-rail-hint">{hint}</span>}
      </div>
      <div className="browse-grid">
        {puzzles.map(p => (
          <PuzzleCard key={p.id} puzzle={p} onPlay={onPlay} onCreator={onCreator} />
        ))}
      </div>
    </section>
  );
}

export default function HomePage({ onPlay, onCreator }: HomePageProps) {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getStats(),
      api.getLeaderboard(),
      api.listPuzzles({ featured: true, limit: 2 }),
      api.listPuzzles({ solved: 'unsolved', sort: 'new', limit: 2 }),
      api.listPuzzles({ reqs: ['tspin'], sort: 'solves', limit: 2 }),
      api.listPuzzles({ reqs: ['pc'], sort: 'solves', limit: 2 }),
      api.listPuzzles({ reqs: ['attack'], sort: 'solves', limit: 2 }),
    ])
      .then(([stats, lb, featured, unsolved, tspin, pc, attack]) => {
        if (cancelled) return;
        setData({
          stats,
          leaders: lb.leaders.slice(0, 5),
          featured: featured.puzzles,
          unsolved: unsolved.puzzles,
          tspin: tspin.puzzles,
          pc: pc.puzzles,
          attack: attack.puzzles,
        });
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="browse-status">
        <div className="browse-error">couldn't load the front page: {error}</div>
        <div className="browse-hint">is the server running on :3000?</div>
      </div>
    );
  }
  if (data == null) return <div className="browse-status">loading…</div>;

  const empty =
    data.featured.length === 0 && data.unsolved.length === 0 &&
    data.tspin.length === 0 && data.pc.length === 0 && data.attack.length === 0;

  return (
    <div className="home">
      <div className="home-stats">
        <div className="home-stat">
          <span className="home-stat-num">{data.stats.puzzles.toLocaleString()}</span>
          <span className="home-stat-label">puzzles</span>
        </div>
        <div className="home-stat">
          <span className="home-stat-num">{data.stats.solves.toLocaleString()}</span>
          <span className="home-stat-label">solves</span>
        </div>
        <div className="home-stat">
          <span className="home-stat-num">{data.stats.users.toLocaleString()}</span>
          <span className="home-stat-label">players</span>
        </div>
      </div>

      <div className="home-main">
        <section className="home-rail">
          <div className="home-rail-head">
            <span className="home-rail-title">LEADERBOARD</span>
            <span className="home-rail-hint">top solvers</span>
          </div>
          {data.leaders.length === 0 ? (
            <div className="profile-empty">no solves recorded yet</div>
          ) : (
            <ol className="leaderboard">
              {data.leaders.map((entry, i) => (
                <li key={entry.username} className={`leader-row rank-${i + 1}`}>
                  <span className="leader-rank">{i + 1}</span>
                  <button
                    className="leader-name"
                    onClick={() => onCreator?.(entry.username)}
                  >
                    {entry.username}
                  </button>
                  <span className="leader-solves">
                    {entry.solves}
                    {entry.first_solves > 0 && (
                      <span className="leader-firsts" title={`${entry.first_solves} first solves`}>
                        <Star className="glyph-icon" fill="currentColor" />{entry.first_solves}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {empty && (
          <div className="browse-status">no puzzles quite yet...</div>
        )}
        <Rail title="FEATURED" puzzles={data.featured} onPlay={onPlay} onCreator={onCreator} />
        <Rail
          title="UNSOLVED PUZZLES"
          hint="be the first to crack these"
          puzzles={data.unsolved}
          onPlay={onPlay}
          onCreator={onCreator}
        />
        <Rail title="T-SPIN PUZZLES" puzzles={data.tspin} onPlay={onPlay} onCreator={onCreator} />
        <Rail title="PC PUZZLES" puzzles={data.pc} onPlay={onPlay} onCreator={onCreator} />
        <Rail title="ATTACK PUZZLES" puzzles={data.attack} onPlay={onPlay} onCreator={onCreator} />
      </div>
    </div>
  );
}
