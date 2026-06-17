-- Per-user puzzle attempts, mirroring the `solves` table, so difficulty can be gauged as
-- solves / attempts. One row per (puzzle, user); UNIQUE makes recording idempotent.
CREATE TABLE public.attempts (
    id         uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    puzzle_id  uuid NOT NULL REFERENCES public.puzzles(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (puzzle_id, user_id)
);

CREATE INDEX attempts_puzzle_idx ON public.attempts (puzzle_id);
