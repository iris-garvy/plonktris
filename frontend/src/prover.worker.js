import init, { initThreadPool, prove_requirements } from "./pkg/wasm.js";

const SERVER_URL = "http://localhost:3000";

let wasmReady = false;

init().then(async () => {
    await initThreadPool(navigator.hardwareConcurrency);
    wasmReady = true;
    postMessage({ type: "ready" });
});

onmessage = async function(e) {
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
            const headers = { "Content-Type": "application/json" };
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
            if (!res.ok) throw new Error(`submit failed: ${res.statusText}`);
            const { proof_id } = await res.json();

            const resultPuzzleId = await pollJob(proof_id);
            postMessage({ type: "proof", id, proof: resultPuzzleId });
        }
    } catch (err) {
        // JsValue errors from wasm don't have .message, they ARE the message
        const message = err instanceof Error ? err.message : String(err);
        postMessage({ type: "error", id, error: message });
    }
};

async function pollJob(jobId) {
    while (true) {
        await sleep(2000);
        const res = await fetch(`${SERVER_URL}/jobs/${jobId}`);
        if (!res.ok) throw new Error(`poll failed: ${res.statusText}`);
        const job = await res.json();
        console.log("poll:", job);
        if (job.status === "done") return job.puzzle_id;
        if (job.status === "failed") throw new Error(`job failed: ${job.failed_reason}`);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}