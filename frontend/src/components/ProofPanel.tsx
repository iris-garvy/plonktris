import { useState } from 'react';
import './ProofPanel.css';

interface ProofPanelProps {
  isReady: boolean;
  isProving: boolean;
  error: unknown;
  proof: unknown;
  onProve: (secure: boolean) => void;
  disabled: boolean;
  /** whether the per-prove "secure proving" option is available */
  allowSecure: boolean;
  /** server fast-proving limit hit — only in-browser proving is left */
  rateLimited: boolean;
}

export default function ProofPanel({ isProving, error, proof, onProve, disabled, allowSecure, rateLimited }: ProofPanelProps) {
  const [secure, setSecure] = useState(false);
  const submitted = !!proof && !error;
  const useSecure = allowSecure && secure;

  const localOnly = submitted && (proof as { localOnly?: boolean }).localOnly === true;
  const provedSecurely = submitted && (proof as { secure?: boolean }).secure === true;

  return (
    <div className="proof-panel">
      {rateLimited && !submitted ? (
        <>
          <div className="rate-limit-note">⚡ fast proving limit reached</div>
          <button
            className={`prove-btn ${isProving ? 'proving' : ''}`}
            onClick={() => onProve(true)}
            disabled={isProving || disabled}
          >
            {isProving ? (
              <span className="proving-inner"><span className="spinner" />proving…</span>
            ) : '🔒 prove securely'}
          </button>
          <div className="rate-limit-sub">proves in your browser — slower, keep this tab open</div>
        </>
      ) : (
        <>
          {allowSecure && !submitted && (
            <label className="secure-toggle">
              <input
                type="checkbox"
                checked={secure}
                onChange={e => setSecure(e.target.checked)}
                disabled={isProving}
              />
              🔒 secure (slow)
            </label>
          )}

          <button
            className={`prove-btn ${isProving ? 'proving' : ''}`}
            onClick={() => onProve(useSecure)}
            disabled={isProving || disabled || submitted}
          >
            {isProving ? (
              <span className="proving-inner">
                <span className="spinner" />
                {useSecure ? 'proving…' : 'submitting…'}
              </span>
            ) : submitted ? (
              localOnly ? '✓ solved' : '✓ submitted'
            ) : (
              useSecure ? '🔒 secure submit' : '⬡ submit'
            )}
          </button>
        </>
      )}

      {!!error && (
        <div className="proof-error">
          <div className="error-label">ERROR</div>
          <div className="error-body">{String(error)}</div>
        </div>
      )}

      {submitted && (
        <div className="proof-success">
          {localOnly ? (
            <>
              <div className="success-label">solved!</div>
              <div className="success-sub">log in to record your solve</div>
            </>
          ) : provedSecurely ? (
            <>
              <div className="success-label">verified! &amp; recorded!</div>
              <div className="success-sub">proved!</div>
            </>
          ) : (
            <>
              <div className="success-label">submitted!</div>
              <div className="success-sub">check your profile for the result</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
