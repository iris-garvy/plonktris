import './ProofPanel.css';

function hexSnippet(proof) {
  if (!proof) return null;
  const bytes = proof instanceof Uint8Array ? proof : new Uint8Array(proof);
  const hex = Array.from(bytes.slice(0, 32))
    .map(b => b.toString(16).padStart(2, '0'))
    .join(' ');
  return `${hex}${bytes.length > 32 ? ' …' : ''} (${bytes.length} bytes)`;
}

export default function ProofPanel({ isReady, isProving, error, proof, onProve, disabled }) {
  const proofHex = hexSnippet(proof);
  const proofHash = proof
    ? Array.from((proof instanceof Uint8Array ? proof : new Uint8Array(proof)).slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
    : null;

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
          <div className="proof-hash">
            <span className="hash-label">hash</span>
            <span className="hash-value">0x{proofHash}</span>
          </div>
          <div className="proof-hex">{proofHex}</div>
        </div>
      )}

    </div>
  );
}
