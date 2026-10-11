-- Replay verification replaces ZK proofs: the server now verifies a solve by replaying the
-- client's action bytes through its port of the game engine, and stores those bytes.
--
-- Non-destructive: proofs are no longer produced, so `puzzles.proof` becomes optional, but
-- existing proofs and the old `jobs` table (proving queue, now unused) are left in place.
-- Idempotent — safe to run more than once.
ALTER TABLE public.puzzles ALTER COLUMN proof DROP NOT NULL;
ALTER TABLE public.puzzles ADD COLUMN IF NOT EXISTS solution bytea;
ALTER TABLE public.solves  ADD COLUMN IF NOT EXISTS solution bytea;
