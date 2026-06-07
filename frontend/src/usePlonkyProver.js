import { useState, useEffect, useRef, useCallback } from "react";

const WASM_MODULE_PATH = "/wasm/wasm.js";
const PROVE_FN_NAME = "prove_requirements";

let wasmModule = null;

export function usePlonkyProver() {
    const [isReady, setIsReady] = useState(false);
    const [isProving, setIsProving] = useState(false);
    const [error, setError] = useState(null);
    const workerRef = useRef(null);

    useEffect(() => {
        const worker = new Worker(
            new URL('./prover.worker.js', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = (e) => {
            if (e.data.type === "ready") {
                setIsReady(true);
            }
        };

        workerRef.current = worker;

        return () => worker.terminate();
    }, []);

    const prove = useCallback((board, queue, requirements, secretMoves) => {
        return new Promise((resolve, reject) => {
            setIsProving(true);
            setError(null);

            workerRef.current.onmessage = (e) => {
                if (e.data.type === "proof") {
                    setIsProving(false);
                    resolve(e.data.proof);
                } else if (e.data.type === "error") {
                    setIsProving(false);
                    setError(e.data.error);
                    reject(new Error(e.data.error));
                }
            };

            workerRef.current.postMessage({ board, queue, requirements, secretMoves });
        });
    }, []);

    return {prove, isReady, isProving, error};
}