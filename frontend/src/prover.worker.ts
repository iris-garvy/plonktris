import init, { initThreadPool, prove_requirements } from "./pkg/wasm.js";

const SERVER_URL = "http://localhost:3000";

let wasmReady = false;

init().then(async () => {
    await initThreadPool(navigator.hardwareConcurrency);
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
            const proof = prove_requirements(board, queue, requirements, secretMoves);
            postMessage({ type: "proof", id, proof });
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
            // server validates synchronously (auth, duplicate, name, inputs)
            // then queues the job; we resolve as soon as it's accepted and let
            // the proving happen async — status shows on the user's profile
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
