import './ProofPanel.css';

interface ProofPanelProps {
  isReady: boolean;
  isProving: boolean;
  error: unknown;
  proof: unknown;
  onProve: () => void;
  disabled: boolean;
}

export default function ProofPanel({ isProving, error, proof, onProve, disabled }: ProofPanelProps) {
  const submitted = !!proof && !error;
  return (
    <div className="proof-panel">
      <button
        className={`prove-btn ${isProving ? 'proving' : ''}`}
        onClick={onProve}
        disabled={isProving || disabled || submitted}
      >
        {isProving ? (
          <span className="proving-inner">
            <span className="spinner" />
            submitting…
          </span>
        ) : submitted ? (
          '✓ submitted'
        ) : (
          '⬡ submit'
        )}
      </button>

      {!!error && (
        <div className="proof-error">
          <div className="error-label">ERROR</div>
          <div className="error-body">{String(error)}</div>
        </div>
      )}

      {submitted && (
        <div className="proof-success">
          <div className="success-label">✓ submitted — verifying</div>
          <div className="success-sub">check your profile for the result</div>
        </div>
      )}
    </div>
  );
}
