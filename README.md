# Plonktris

[plonktris.com](https://plonktris.com)

Plonktris is a Tetris puzzle platform where only the puzzle creator knows the solution. Users prove a puzzle is solvable with a zero knowledge proof; the proof is verified without revealing *how* the puzzle was solved. Built on plonky2 (PLONK + FRI over the Goldilocks field) with recursive IVC to prove arbitrarily long solutions within browser memory constraints, and constant-size proofs that verify in constant time regardless of solution length.

> **Disclaimer:** the proofs aren't *actually* run in zero knowledge mode right now (purely for cost). Blinding the witness roughly doubles proving cost, so the live system uses non-ZK succinct validity proofs. Plonktris uses 2 differenct circuits and both can be made zero knowledge without toooooo much effort.

## Performance

| Circuit | Gates | Prove | Verify | Proof size |
|---|---|---|---|---|
| Monolithic (4 pieces) | 16,384 | 4.3s | 3ms | 154 KB |
| Monolithic (6–8 pieces) | 32,768 | 8.9s | 3ms | 161 KB |
| Recursive (11+ pieces) | — | ~30s | 3ms | 147 KB |

Verification time and proof size are constant regardless of solution length. The recursive prover handles solutions past the ~11 piece WASM memory wall where the monolithic circuit OOMs. Note that these numbers were benchmarked for an M3, it's slower for WASM proving and the current plonktris server.

## Architecture

1. **Puzzle creation** user draws a board and specifies a piece queue in the frontend.
2. **Solution recording** the in-browser Tetris player records all actions taken to solve the puzzle.
3. **Prover selection** proving is routed by solution length, independently of where it runs:
   - ≤8 pieces: the monolithic circuit (one proof for the whole solution)
   - \>8 pieces: the recursive prover (uses chunked IVC and folds per-chunk step proofs into one aggregate), which keeps memory bounded past the ~11-piece wall where the monolithic circuit OOMs in WASM
   Both provers are compiled to WASM (client-side proving) and run on the server (Fly.io); the same circuits and config are shared across both so a browser-made proof verifies server-side.
4. **Server-side job queue** `/request` enqueues a job (Postgres `jobs` table, status `pending`). A background worker claims the oldest pending job, marks it `proving`, and runs the prover; the client polls `/jobs/:id` for status. Jobs left `proving` by a crash are reclaimed to `pending` on restart.
5. **Verification & storage** the server verifies the proof and binds its public inputs to the submitted board/queue/requirements, then saves the proof and puzzle to Postgres. The submitted solution is used only to generate the proof and is then discarded.

## Stack

Rust, plonky2, Axum, Postgres, Fly.io, React, WASM
