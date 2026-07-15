import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "./api";

export interface ProveExtra {
  puzzleId?: string;
  name?: string;
}

export type ProveResult =
  | { accepted: true; secure: true; jobId: string }  // in-browser proof, verified synchronously
  | { accepted: true; jobId: string }                // server proof queued
  | { rateLimited: true };                            // fast-proving limit hit

interface PendingEntry {
  resolve: (proof: Uint8Array) => void;
  reject: (err: Error) => void;
}

interface WorkerMessage {
  type: 'ready' | 'proof' | 'error';
  id?: string;
  proof?: Uint8Array;
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

            if (type === "ready") { setIsReady(true); return; }
            if (!id) return;

            const pending = pendingRef.current.get(id);
            if (!pending) return;
            pendingRef.current.delete(id);

            if (type === "proof" && proof) pending.resolve(proof);
            else if (type === "error") pending.reject(new Error(error ?? 'proving failed'));
        };

        workerRef.current = worker;
        return () => worker.terminate();
    }, []);

    // run wasm proving in the worker; resolves with the raw proof bytes
    const workerProve = useCallback((
        board: Uint8Array, queue: Uint8Array, requirements: Uint8Array, secretMoves: Uint8Array,
    ) => {
        const id = crypto.randomUUID();
        return new Promise<Uint8Array>((resolve, reject) => {
            pendingRef.current.set(id, { resolve, reject });
            workerRef.current?.postMessage({ id, board, queue, requirements, secretMoves });
        });
    }, []);

    const prove = useCallback(async (
        board: Uint8Array,
        queue: Uint8Array,
        requirements: Uint8Array,
        secretMoves: Uint8Array,
        mode: 'browser' | 'server',
        extra: ProveExtra = {},
    ): Promise<ProveResult> => {
        setIsProving(true);
        setError(null);

        // publish mode: name set; solve mode: puzzle_id set (never both)
        const name = extra.puzzleId ? undefined : (extra.name || 'untitled');
        const puzzle_id = extra.puzzleId || undefined;
        const target = {
            board: Array.from(board),
            queue: Array.from(queue),
            requirements: Array.from(requirements),
            name, puzzle_id,
        };

        try {
            if (mode === "browser") {
                // prove locally, then send only the proof — the solution never leaves the browser
                const proof = await workerProve(board, queue, requirements, secretMoves);
                const { proof_id } = await api.submitProof({ ...target, proof: Array.from(proof) });
                return { accepted: true, secure: true, jobId: proof_id };
            } else {
                // hand the solution to the server, which proves it asynchronously
                const res = await api.requestServerProof({ ...target, actions: Array.from(secretMoves) });
                if ('rateLimited' in res) return { rateLimited: true };
                return { accepted: true, jobId: res.proof_id };
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            setError(message);
            throw e instanceof Error ? e : new Error(message);
        } finally {
            setIsProving(false);
        }
    }, [workerProve]);

    return { prove, isReady, isProving, error };
}
