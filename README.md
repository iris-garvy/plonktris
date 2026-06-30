# Plonktris

[plonktris.com](https://plonktris.com)

Plonktris is a Tetris puzzle platform where solution privacy is enforced cryptographically. Users submit zero-knowledge proofs of solvability — the server verifies the proof without ever seeing the solution. Built on plonky2 with recursive IVC to handle arbitrarily long solutions within browser memory constraints.

## Performance

| Circuit | Gates | Prove | Verify | Proof size |
|---|---|---|---|---|
| Monolithic (4 pieces) | 16,384 | 4.3s | 3ms | 154 KB |
| Monolithic (6–8 pieces) | 32,768 | 8.9s | 3ms | 161 KB |
| Recursive (11+ pieces) | — | ~30s | 3ms | 147 KB |

Verification time and proof size are constant regardless of solution length. The recursive prover handles solutions past the ~11-piece WASM memory wall where the monolithic circuit OOMs.

## Architecture

1. **Puzzle creation** user draws a board and specifies a piece queue in the frontend.
2. **Solution recording** the in-browser Tetris player records all actions taken to solve the puzzle.
3. **Proof routing** the backend receives the solution, validates basic constraints, then routes to the appropriate prover:
   - Short puzzles (≤8 pieces): monolithic circuit, proven server-side on Fly.io
   - Any length, browser proving requested: recursive prover compiled to WASM, runs client-side
   - Longer puzzles, server proving: recursive prover on Fly.io
4. **Verification & storage** proof and puzzle are saved to Postgres; the solution itself is never stored.
5. **Async proving** backend workers process a proof queue so users aren't blocked waiting on proof generation.

## Stack

Rust, plonky2, Axum, Postgres, Fly.io, React, WASM
