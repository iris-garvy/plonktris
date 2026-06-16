// Integration tests for the monolithic MonoCircuit (build/prove/verify_bytes) using the
// crate's public API only. Run with `cargo test --release -p circuit --test mono` — debug
// plonky2 builds are glacial.
use circuit::*;

// A trivial-but-valid 3-piece puzzle: empty board, three T pieces, no requirements,
// all moves = 6 (hard-drop). Matches the known-good case in the wasm crate's test.
fn sample(num_pieces: usize) -> (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
    let board = vec![0u8; 210];
    let queue = vec![2u8; num_pieces];
    let requirements = vec![0u8; 8];
    let secret_moves = vec![6u8; num_pieces * 32];
    (board, queue, requirements, secret_moves)
}

#[test]
fn prove_verify_roundtrip_and_no_drift() {
    let n = 3;
    let (board, queue, reqs, moves) = sample(n);

    let circuit = MonoCircuit::build(n);
    let bytes = circuit.prove(&board, &queue, &reqs, &moves).expect("prove").to_bytes();

    // The circuit that proved it verifies it.
    circuit.verify_bytes(&bytes, &board, &queue, &reqs).expect("self-verify");

    // A SEPARATELY built circuit of the same length also verifies it. This is the bug that
    // produced "invalid proof bytes: io error" before — prover and verifier had drifted.
    let other = MonoCircuit::build(n);
    other.verify_bytes(&bytes, &board, &queue, &reqs).expect("cross-verify (no drift)");
}

#[test]
fn binding_rejects_wrong_puzzle() {
    let n = 3;
    let (board, queue, reqs, moves) = sample(n);
    let circuit = MonoCircuit::build(n);
    let bytes = circuit.prove(&board, &queue, &reqs, &moves).expect("prove").to_bytes();

    // Claiming a different queue must fail the public-input binding.
    let wrong_queue = vec![3u8; n];
    assert!(circuit.verify_bytes(&bytes, &board, &wrong_queue, &reqs).is_err(),
        "verify should reject a mismatched queue");

    // Claiming a stricter requirement than was proven must fail too.
    let mut wrong_reqs = vec![0u8; 8];
    wrong_reqs[0] = 1;
    assert!(circuit.verify_bytes(&bytes, &board, &queue, &wrong_reqs).is_err(),
        "verify should reject mismatched requirements");
}
