-- Puzzle ownership + naming, and job context for who/what a proof is for.

ALTER TABLE puzzles
    ADD COLUMN name       text NOT NULL DEFAULT 'untitled',
    ADD COLUMN creator_id uuid REFERENCES users(id),
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

-- jobs carry the submitting user and, when solving an existing puzzle
-- (rather than publishing a new one), the puzzle being solved.
ALTER TABLE jobs
    ADD COLUMN user_id          uuid REFERENCES users(id),
    ADD COLUMN target_puzzle_id uuid REFERENCES puzzles(id),
    ADD COLUMN name             text;

CREATE INDEX puzzles_created_idx ON puzzles(created_at DESC);
