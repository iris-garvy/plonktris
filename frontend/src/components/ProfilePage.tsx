import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { api, type Puzzle, type UserProfile } from '../api';
import PuzzleCard from './PuzzleCard';
import KeybindingsEditor from './KeybindingsEditor';
import { type Bindings, type Handling } from '../keybindings';
import './ProfilePage.css';

interface ProfilePageProps {
  username: string;
  onPlay: (puzzle: Puzzle) => void;
  onCreator: (username: string) => void;
  isOwner: boolean;
  secureProving: boolean;
  onSecureProvingChange: (v: boolean) => void;
  bindings: Bindings;
  onBindingsChange: (next: Bindings) => void;
  handling: Handling;
  onHandlingChange: (next: Handling) => void;
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ProfilePage({
  username, onPlay, onCreator, isOwner, secureProving, onSecureProvingChange,
  bindings, onBindingsChange, handling, onHandlingChange,
}: ProfilePageProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function load(initial: boolean) {
      if (initial) { setProfile(null); setError(null); }
      api.getUserProfile(username)
        .then(p => {
          if (cancelled) return;
          setProfile(p);
          // while submissions are still proving, refresh so they resolve live
          if (p.pending.some(j => j.status !== 'failed')) {
            timer = setTimeout(() => load(false), 3000);
          }
        })
        .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    }

    load(true);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [username]);

  if (error) {
    return <div className="browse-status"><div className="browse-error">{error}</div></div>;
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

      {profile.pending.length > 0 && (
        <section className="profile-section">
          <div className="profile-section-label">SUBMISSIONS</div>
          <div className="pending-list">
            {profile.pending.map(job => (
              <div key={job.id} className={`pending-row ${job.status}`}>
                <span className="pending-name">{job.name}</span>
                {job.status === 'failed' ? (
                  <span className="pending-status failed" title={job.failed_reason ?? ''}>
                    <X className="glyph-icon glyph-lead" />failed{job.failed_reason ? `: ${job.failed_reason}` : ''}
                  </span>
                ) : (
                  <span className="pending-status">submitted — verifying…</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="profile-section">
        <div className="profile-section-label">CREATED</div>
        {profile.created.length === 0 ? (
          <div className="profile-empty">no puzzles published yet</div>
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
          <label className="profile-setting">
            <input
              type="checkbox"
              checked={secureProving}
              onChange={e => onSecureProvingChange(e.target.checked)}
            />
            <span className="profile-setting-text">
              <span className="profile-setting-name">secure proving</span>
              <span className="profile-setting-desc">
                adds a secure option for proof submission that generates entirely within browser. WARNING: this is much slower.
              </span>
            </span>
          </label>

          <div className="profile-keys">
            <KeybindingsEditor
              bindings={bindings}
              onChange={onBindingsChange}
              handling={handling}
              onHandlingChange={onHandlingChange}
            />
          </div>
        </section>
      )}
    </div>
  );
}
