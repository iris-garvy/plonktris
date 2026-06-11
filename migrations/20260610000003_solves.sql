-- A verified solve of someone else's puzzle. The proof shows the solver
-- met the requirements without revealing their move sequence.

CREATE TABLE solves (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    puzzle_id  uuid NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proof      bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (puzzle_id, user_id)
);

CREATE INDEX solves_puzzle_idx ON solves(puzzle_id);
