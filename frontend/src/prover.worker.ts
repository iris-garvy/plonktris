import init, { prove_requirements, prove_requirements_recursive } from "./pkg/wasm.js";

// Must match the server's MONOLITHIC_MAX_PIECES: puzzles longer than this use the
// recursive (memory-bounded) prover so they fit in wasm, and the server verifies them
// as recursive proofs.
const MONOLITHIC_MAX_PIECES = 8;

let wasmReady = false;

init().then(() => {
    wasmReady = true;
    postMessage({ type: "ready" });
});

interface ProveRequest {
    id: string;
    board: Uint8Array;
    queue: Uint8Array;
    requirements: Uint8Array;
    secretMoves: Uint8Array;
}

// The worker's sole job is CPU-bound wasm proving, off the main thread. It returns the
// raw proof bytes; the caller owns the network protocol (see api.ts / usePlonkyProver).
onmessage = function (e: MessageEvent<ProveRequest>) {
    const { id, board, queue, requirements, secretMoves } = e.data;

    if (!wasmReady) {
        postMessage({ type: "error", id, error: "WASM not ready yet" });
        return;
    }

    try {
        const proof = queue.length > MONOLITHIC_MAX_PIECES
            ? prove_requirements_recursive(board, queue, requirements, secretMoves)
            : prove_requirements(board, queue, requirements, secretMoves);
        postMessage({ type: "proof", id, proof });
    } catch (err) {
        // JsValue errors from wasm don't have .message, they ARE the message
        const message = err instanceof Error ? err.message : String(err);
        postMessage({ type: "error", id, error: message });
    }
};
