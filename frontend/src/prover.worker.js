import init, { prove_requirements } from "./wasm/wasm.js";

init().then(() => {
    postMessage({ type: "ready" });
});

onmessage = function(e) {
    const { board, queue, requirements, secretMoves } = e.data;
    try {
        const proof = prove_requirements(board, queue, requirements, secretMoves);
        postMessage({ type: "proof", proof });
    } catch (err) {
        postMessage({ type: "error", error: err.message });
    }
};