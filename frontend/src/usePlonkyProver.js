import { useState, useEffect, useRef, useCallback } from "react";

export function usePlonkyProver() {
    const [isReady, setIsReady] = useState(false);
    const [isProving, setIsProving] = useState(false);
    const [error, setError] = useState(null);

    const workerRef = useRef(null);
    const pendingRef = useRef(new Map());

    useEffect(() => {
        const worker = new Worker(
            new URL('./prover.worker.js', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = (e) => {
            const { type, id, proof, error, } = e.data;

            if (type === "ready") {
                setIsReady(true);
                return;
            }

            const pending = pendingRef.current.get(id);
            if (!pending) return;

            if (type === "proof") {
                pending.resolve(proof);
                pendingRef.current.delete(id);
                setIsProving(false);
            }

            if (type === "error") {
                pending.reject(new Error(error));
                pendingRef.current.delete(id);
                setIsProving(false);
                setError(error);
            }
        };

        workerRef.current = worker;

        return () => worker.terminate();
    }, []);

    const prove = useCallback((board, queue, requirements, secretMoves, mode) => {
        const id = crypto.randomUUID();

        setIsProving(true);
        setError(null);

        return new Promise((resolve, reject) => {
            pendingRef.current.set(id, { resolve, reject });

            workerRef.current.postMessage({
                type: "prove",
                id,
                board,
                queue,
                requirements,
                secretMoves,
                mode
            });
        });
    }, []);

    return { prove, isReady, isProving, error };
}