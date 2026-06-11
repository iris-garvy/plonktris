import './ProofPanel.css';

export default function ProofPanel({ isReady, isProving, error, proof, onProve, disabled }) {
  return (
    <div className="proof-panel">
      <button
        className={`prove-btn ${isProving ? 'proving' : ''}`}
        onClick={onProve}
        disabled={isProving || disabled}
      >
        {isProving ? (
          <span className="proving-inner">
            <span className="spinner" />
            proving…
          </span>
        ) : (
          '⬡ prove'
        )}
      </button>

      {error && (
        <div className="proof-error">
          <div className="error-label">ERROR</div>
          <div className="error-body">{error.toString()}</div>
        </div>
      )}

      {proof && !error && (
        <div className="proof-success">
          <div className="success-label">✓ PROOF VALID</div>
        </div>
      )}

    </div>
  );
}
