# Plonktris

[plonktris.com](https://plonktris.com)

![Plonktris screenshot](frontend/public/homepage.png)

Plonktris is a Tetris puzzle site. Players build puzzles — a starting board, a fixed piece
queue (up to 30 pieces) and goals like "2 T-spin doubles", "a perfect clear" or "6 attack, no
hold" — and everyone else tries to solve them. Every published puzzle has been solved by its
creator, and every solve is replayed and verified by the server before it counts, so solve
counts, first solves and the leaderboard are trustworthy.

The game itself aims to feel like jstris: correct SRS (with 180s), configurable DAS / ARR /
soft-drop speed, rebindable keys, instant undo and restart. There's no gravity and no lock
delay — pieces only lock on hard drop — so puzzles are about planning, not speed.

> The original version of plonktris verified solvability with plonky2 zero-knowledge proofs
> (in-browser WASM or a server-side prover). That version is preserved at git tag `zk-final`.

## How it works

```
frontend (React + Vite, static)                    server (Rust, Axum)              Postgres
┌──────────────────────────────────┐   JSON    ┌────────────────────────────┐   ┌──────────┐
│ game/engine.ts  — the rules      │ ───────▶  │ engine.rs — a port of      │ ─▶│ users    │
│ PuzzlePlayer records each        │  solution │ engine.ts; replays every   │   │ puzzles  │
│ effective action as one byte     │  (bytes)  │ publish / solve            │   │ solves   │
└──────────────────────────────────┘           └────────────────────────────┘   └──────────┘
```

1. **One deterministic engine.** `frontend/src/game/engine.ts` is the source of truth for the
   rules: board, SRS kicks, hold, T-spin detection and the attack / combo / back-to-back / PC
   scoring tables. It's pure TypeScript with no React or DOM.
2. **Solutions are action lists.** While you play, the client records every action that
   actually changed the game (left, right, cw, ccw, 180, soft drop, hold, hard drop) as one
   byte each.
3. **The server replays them.** `crates/server/src/engine.rs` is a line-for-line Rust port of
   the engine. Publishing a puzzle (`POST /puzzles`) or submitting a solve
   (`POST /puzzles/:id/solve`) replays the solution against the puzzle; it's only accepted if
   every piece gets placed and the goals are met. Verification is synchronous and takes
   microseconds — no job queue, no polling.
4. **The two engines are kept in lockstep** by shared fixtures: `shared/gen-fixtures.ts` runs
   a few hundred puzzles/solutions through the TypeScript engine and writes
   `shared/engine-fixtures.json`; `cargo test` replays the same cases through the Rust port and
   requires identical results. After any change to `engine.ts`, regenerate the fixtures
   (`node shared/gen-fixtures.ts`) and run `cargo test`.

## Local development

You need Rust (stable), Node 22+ and Postgres.

```sh
# 1. database
createdb plonktris
for f in crates/server/migrations/*.sql; do psql plonktris -f "$f"; done

# 2. server  (listens on :3000)
DATABASE_URL=postgresql://localhost/plonktris cargo run -p plonktris-server

# 3. frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

The frontend talks to `http://localhost:3000` unless `VITE_API_URL` is set. Useful checks:
`cargo test` (server + engine fixtures), and in `frontend/`: `npm test` (vitest),
`npm run typecheck`, `npm run build`.

The server's queries are checked at compile time by sqlx, either against the database in
`DATABASE_URL` or, with `SQLX_OFFLINE=true`, against the cached metadata in `.sqlx/` (that's
what the Docker build uses). If you change a query, run `cargo sqlx prepare` with a migrated
database to refresh the cache.

## Cheap hosting

The whole thing runs on free tiers or close to it: a static frontend, a tiny Rust server that
can sleep when idle, and serverless Postgres.

### Database: Neon (free tier)

1. Create a Neon project and copy its connection string. It must include
   `sslmode=require`, e.g.
   `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/plonktris?sslmode=require`.
2. Moving from an existing database:
   ```sh
   pg_dump --no-owner --no-acl -Fc "$OLD_DATABASE_URL" -f plonktris.dump
   pg_restore --no-owner --no-acl -d "$NEON_DATABASE_URL" plonktris.dump
   ```
   then apply any migrations the old database doesn't have yet — for a database from the ZK
   era that's `0003_replay.sql` (non-destructive, safe to re-run, and the old server keeps
   working after it):
   `psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 -f crates/server/migrations/0003_replay.sql`.
   Starting fresh instead: run every file in `crates/server/migrations/` in order.

### Server: Fly.io (scale to zero) or any Docker host

The server is a single small binary (see `Dockerfile`). Environment:

| variable | meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string (with `sslmode=require` for Neon) |
| `ALLOWED_ORIGINS` | comma-separated origins allowed by CORS, e.g. `https://plonktris.com,https://plonktris.pages.dev` |
| `PORT` | port to listen on (most container hosts set this for you) |

On Fly, `fly.toml` is set up to stop the machine when idle and start it on the next request,
on the smallest VM, so an unused server costs (almost) nothing; the first request after a
nap takes a second or two.

```sh
fly launch --no-deploy          # first time only; keeps the existing fly.toml
fly secrets set DATABASE_URL='postgresql://…?sslmode=require' \
                ALLOWED_ORIGINS='https://plonktris.com'
fly deploy
```

Any other host that can run a Dockerfile and sets `PORT` (Render, Railway, Koyeb, a VPS…)
works the same way.

### Frontend: Cloudflare Pages

Connect the repo in Cloudflare Pages with:

| setting | value |
|---|---|
| root directory | `frontend` |
| build command | `npm run build` |
| output directory | `dist` |
| environment variable | `VITE_API_URL=https://<your-server>` (no trailing slash) |

`frontend/public/_redirects` sends every path to `index.html`, so links like `/p/<id>` work.
`frontend/vercel.json` does the same on Vercel if you'd rather host there. Remember to add the
Pages domain to the server's `ALLOWED_ORIGINS`.

## Stack

TypeScript, React, Vite · Rust, Axum, sqlx · Postgres
