import { useState, useEffect } from 'react';
import { api, ApiError, errorMessage, type Puzzle, type UserProfile } from '../api';
import PuzzleCard from './PuzzleCard';
import { GearIcon } from './icons';
import './BrowsePage.css';
import './ProfilePage.css';

interface ProfilePageProps {
  username: string;
  onPlay: (puzzle: Puzzle) => void;
  onCreator: (username: string) => void;
  isOwner: boolean;
  onOpenSettings: () => void;
  onCreate: () => void;
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ProfilePage({ username, onPlay, onCreator, isOwner, onOpenSettings, onCreate }: ProfilePageProps) {
  // keyed by the username it belongs to, so switching profiles never flashes the old one
  const [loaded, setLoaded] = useState<{ for: string; profile: UserProfile } | null>(null);
  const [error, setError] = useState<{ for: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.getUserProfile(username)
      .then(p => { if (!cancelled) setLoaded({ for: username, profile: p }); })
      .catch(err => {
        if (cancelled) return;
        const message = err instanceof ApiError && err.status === 404
          ? `there's no player called “${username}”`
          : errorMessage(err);
        setError({ for: username, message });
      });
    return () => { cancelled = true; };
  }, [username, attempt]);

  const profile = loaded?.for === username ? loaded.profile : null;
  if (profile == null && error?.for === username) {
    return (
      <div className="browse-status">
        <div className="browse-error">{error.message}</div>
        <button className="browse-retry" onClick={() => { setError(null); setAttempt(a => a + 1); }}>
          try again
        </button>
      </div>
    );
  }
  if (profile == null) {
    return <div className="browse-status">loading profile…</div>;
  }

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-name">{profile.username}</div>
        <div className="profile-meta">
          joined {formatJoined(profile.created_at)} ·{' '}
          {profile.created.length} created · {profile.solved.length} solved
        </div>
      </div>

      <section className="profile-section">
        <div className="profile-section-label">CREATED</div>
        {profile.created.length === 0 ? (
          <div className="profile-empty">
            no puzzles published yet
            {isOwner && <> — <button className="creator-link" onClick={onCreate}>make one</button></>}
          </div>
        ) : (
          <div className="browse-grid compact">
            {profile.created.map(p => (
              <PuzzleCard key={p.id} puzzle={p} onPlay={onPlay} onCreator={onCreator} compact />
            ))}
          </div>
        )}
      </section>

      <section className="profile-section">
        <div className="profile-section-label">SOLVED</div>
        {profile.solved.length === 0 ? (
          <div className="profile-empty">no puzzles solved yet</div>
        ) : (
          <div className="browse-grid compact">
            {profile.solved.map(p => (
              <PuzzleCard key={p.id} puzzle={p} onPlay={onPlay} onCreator={onCreator} compact />
            ))}
          </div>
        )}
      </section>

      {isOwner && (
        <section className="profile-section">
          <div className="profile-section-label">SETTINGS</div>
          <div className="profile-settings-link">
            <span>controls and handling (DAS, ARR, soft drop) are saved in this browser.</span>
            <button className="profile-settings-btn" onClick={onOpenSettings}>
              <GearIcon className="btn-icon" />open settings
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
