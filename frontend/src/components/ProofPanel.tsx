import { useState } from 'react';
import { Zap } from 'lucide-react';
import { CircleIcon, LockIcon } from './icons';
import './ProofPanel.css';

interface ProofPanelProps {
  isReady: boolean;
  isProving: boolean;
  error: unknown;
  proof: unknown;
  onProve: (secure: boolean) => void;
  disabled: boolean;
  /** user enabled the secure-proving option → show the secure button */
  allowSecure: boolean;
  /** server fast-proving limit hit → fast button locked, secure forced */
  rateLimited: boolean;
}

export default function ProofPanel({ isProving, error, proof, onProve, disabled, allowSecure, rateLimited }: ProofPanelProps) {
  // which button is currently proving, so the spinner lands on the right one
  const [pressedSecure, setPressedSecure] = useState(false);
  const submitted = !!proof && !error;

  const localOnly = submitted && (proof as { localOnly?: boolean }).localOnly === true;
  const provedSecurely = submitted && (proof as { secure?: boolean }).secure === true;

  // secure button shows when the user opted in, or when fast proving is locked
  const showSecure = allowSecure || rateLimited;

  const press = (secure: boolean) => { setPressedSecure(secure); onProve(secure); };

  return (
    <div className="proof-panel">
      {!submitted && (
        <>
          {rateLimited && <div className="rate-limit-note"><Zap className="glyph-icon glyph-lead" />fast proving limit reached</div>}

          <button
            className={`prove-btn ${isProving && !pressedSecure ? 'proving' : ''}`}
            onClick={() => press(false)}
            disabled={isProving || disabled || rateLimited}
            title={rateLimited ? 'must use secure proving' : undefined}
          >
            {isProving && !pressedSecure ? (
              <span className="proving-inner"><span className="spinner" />submitting…</span>
            ) : <><CircleIcon className="btn-icon" />submit</>}
          </button>

          {showSecure && (
            <button
              className={`prove-btn secure ${isProving && pressedSecure ? 'proving' : ''}`}
              onClick={() => press(true)}
              disabled={isProving || disabled}
            >
              {isProving && pressedSecure ? (
                <span className="proving-inner"><span className="spinner" />proving…</span>
              ) : <><LockIcon className="btn-icon" />secure</>}
            </button>
          )}
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
              <div className="success-label">verified!</div>
            </>
          ) : (
            <>
              <div className="success-label">submitted!</div>
              <div className="success-sub">check your profile for progress</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
