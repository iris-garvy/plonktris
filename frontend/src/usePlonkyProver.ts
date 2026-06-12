import { useState, useEffect, useRef, useCallback } from "react";

export interface ProveExtra {
  token?: string | null;
  puzzleId?: string;
  name?: string;
}

interface PendingEntry {
  resolve: (proof: unknown) => void;
  reject: (err: Error) => void;
}

interface WorkerMessage {
  type: 'ready' | 'proof' | 'error';
  id?: string;
  proof?: unknown;
  error?: string;
}

export function usePlonkyProver() {
    const [isReady, setIsReady] = useState(false);
    const [isProving, setIsProving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const workerRef = useRef<Worker | null>(null);
    const pendingRef = useRef(new Map<string, PendingEntry>());

    useEffect(() => {
        const worker = new Worker(
            new URL('./prover.worker.ts', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
            const { type, id, proof, error } = e.data;

            if (type === "ready") {
                setIsReady(true);
                return;
            }
            if (!id) return;

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
                setError(error ?? 'unknown error');
            }
        };

        workerRef.current = worker;

        return () => worker.terminate();
    }, []);

    const prove = useCallback((
        board: Uint8Array,
        queue: Uint8Array,
        requirements: Uint8Array,
        secretMoves: Uint8Array,
        mode: 'browser' | 'server',
        extra: ProveExtra = {},
    ) => {
        const id = crypto.randomUUID();

        setIsProving(true);
        setError(null);

        return new Promise((resolve, reject) => {
            pendingRef.current.set(id, { resolve, reject });

            workerRef.current?.postMessage({
                type: "prove",
                id,
                board,
                queue,
                requirements,
                secretMoves,
                mode,
                token: extra.token,
                puzzleId: extra.puzzleId,
                name: extra.name,
            });
        });
    }, []);

    return { prove, isReady, isProving, error };
}
