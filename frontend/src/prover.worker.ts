import init, { prove_requirements, prove_requirements_recursive } from "./pkg/wasm.js";

const SERVER_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

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
    mode: 'browser' | 'server';
    token?: string | null;
    puzzleId?: string;
    name?: string;
}

onmessage = async function (e: MessageEvent<ProveRequest>) {
    const { id, board, queue, requirements, secretMoves, mode, token, puzzleId, name } = e.data;

    if (!wasmReady) {
        postMessage({ type: "error", id, error: "WASM not ready yet" });
        return;
    }

    try {
        if (mode === "browser") {
            // prove locally, then send only the proof — the solution never leaves the browser.
            // long puzzles use the recursive prover (bounded memory) so they fit in wasm.
            const proof = queue.length > MONOLITHIC_MAX_PIECES
                ? prove_requirements_recursive(board, queue, requirements, secretMoves)
                : prove_requirements(board, queue, requirements, secretMoves);
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${SERVER_URL}/submit`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    proof: Array.from(proof),
                    board: Array.from(board),
                    queue: Array.from(queue),
                    requirements: Array.from(requirements),
                    name: puzzleId ? undefined : (name || 'untitled'),
                    puzzle_id: puzzleId || undefined }),
            });
            if (!res.ok) {
                let msg = res.statusText;
                try {
                    const text = await res.text();
                    try { msg = JSON.parse(text).error ?? text; } catch { msg = text || msg; }
                } catch { /* keep statusText */ }
                throw new Error(msg);
            }
            const { proof_id } = await res.json();
            // secure mode verifies synchronously, so the result is already final
            postMessage({ type: "proof", id, proof: { accepted: true, secure: true, jobId: proof_id } });
        } else if (mode === "server") {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${SERVER_URL}/request`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    board: Array.from(board),
                    queue: Array.from(queue),
                    requirements: Array.from(requirements),
                    actions: Array.from(secretMoves),
                    // publish mode: name set; solve mode: puzzle_id set
                    name: puzzleId ? undefined : (name || 'untitled'),
                    puzzle_id: puzzleId || undefined })
            });
            // 429 = fast-proving rate limit; signal the UI to offer secure proving
            if (res.status === 429) {
                postMessage({ type: "proof", id, proof: { rateLimited: true } });
                return;
            }
            // server validates + queues; proving runs async, result shows on the profile
            if (!res.ok) {
                let msg = res.statusText;
                try {
                    const text = await res.text();
                    try { msg = JSON.parse(text).error ?? text; } catch { msg = text || msg; }
                } catch { /* keep statusText */ }
                throw new Error(msg);
            }
            const { proof_id } = await res.json();
            postMessage({ type: "proof", id, proof: { accepted: true, jobId: proof_id } });
        }
    } catch (err) {
        // JsValue errors from wasm don't have .message, they ARE the message
        const message = err instanceof Error ? err.message : String(err);
        postMessage({ type: "error", id, error: message });
    }
};
