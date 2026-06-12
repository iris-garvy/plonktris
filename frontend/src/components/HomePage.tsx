import { useState, useEffect } from 'react';
import { api, type Puzzle } from '../api';
import PuzzleCard from './PuzzleCard';
import './BrowsePage.css';

interface HomePageProps {
  onPlay: (puzzle: Puzzle) => void;
  onCreator?: (username: string) => void;
}

export default function HomePage({ onPlay, onCreator }: HomePageProps) {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listPuzzles()
      .then(({ puzzles }) => { if (!cancelled) setPuzzles(puzzles); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="browse-status">
        <div className="browse-error">couldn't load puzzles: {error}</div>
        <div className="browse-hint">is the server running on :3000?</div>
      </div>
    );
  }
  if (puzzles == null) return <div className="browse-status">loading puzzles…</div>;
  if (puzzles.length === 0) {
    return (
      <div className="browse-status">
        no puzzles yet — be the first to publish one!
      </div>
    );
  }

  return (
    <div className="browse-grid">
      {puzzles.map(p => (
        <PuzzleCard key={p.id} puzzle={p} onPlay={onPlay} onCreator={onCreator} />
      ))}
    </div>
  );
}
