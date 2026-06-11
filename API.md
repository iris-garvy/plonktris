# Plonktris API contract

The frontend is built against exactly this. Base URL `http://localhost:3000`.
All bodies are JSON. Errors: non-2xx status with a plain-text or
`{"error": "..."}` body — the frontend shows whatever text it gets.

## Auth

Token auth: `Authorization: Bearer <token>` header, where `<token>` is the
session uuid. Suggested crates: `argon2` for password hashing, and an axum
extractor that looks up `sessions.token` → `users` for protected routes.

### POST /auth/register
```json
{ "username": "garvy", "password": "hunter2" }
```
→ `201`
```json
{ "token": "<session-uuid>", "user": { "id": "<uuid>", "username": "garvy" } }
```
- username: 1–32 chars, unique (case-insensitive recommended); 409 on conflict
- hash password with argon2; create session; return token

### POST /auth/login
Same body/response as register. `401` on bad credentials
(same error for unknown user vs wrong password).

### POST /auth/logout  (auth)
Deletes the session. → `200 {}`

### GET /auth/me  (auth)
→ `{ "id": "<uuid>", "username": "garvy" }` — `401` if token invalid.
The frontend calls this on page load to restore the session.

## Puzzles

### GET /puzzles
Public. Newest first, all published puzzles.
```json
{ "puzzles": [ {
    "id": "<uuid>",
    "name": "tsd tutorial 1",
    "creator": "garvy",
    "board": [0,1,0, ...],        // 210 occupancy bits, row 0 = top
    "queue": [2,0,5],             // prover piece ids 0-6 (I=0 … J=6)
    "requirements": [0,1,0,0,0,0,0,0],
    "num_pieces": 3,
    "solve_count": 4,
    "created_at": "2026-06-10T12:00:00Z"
} ] }
```
`board`/`queue`/`requirements` are the stored bytea columns serialized as
JSON arrays of numbers (serde does this for `Vec<u8>` automatically).

### GET /puzzles/:id
Public. Single puzzle, same shape as one list entry. `404` if missing.

## Proving (extends the existing /request flow)

### POST /request  (auth required now)
```json
{
  "board": [...], "queue": [...], "requirements": [...], "actions": [...],
  "name": "my puzzle",          // publish mode: name for the new puzzle
  "puzzle_id": "<uuid>"         // solve mode: the puzzle being solved
}
```
Exactly one of `name` / `puzzle_id` is set.
- store `user_id` (from the session), `name`, `target_puzzle_id` on the job
- response unchanged: `{ "success": true, "proof_id": "<job-uuid>" }`
- `401` if not logged in

Worker, on successful proof verification:
- **publish mode** (`target_puzzle_id` NULL): insert into `puzzles` as today,
  plus `name` and `creator_id = user_id`
- **solve mode**: load the target puzzle; check the job's `board`, `queue`,
  `requirements` are byte-identical to the puzzle's (otherwise mark the job
  failed — the client proved something else); then
  `INSERT INTO solves (puzzle_id, user_id, proof) ... ON CONFLICT DO NOTHING`
  and set the job's `puzzle_id` to the target so the client's poll sees it

### GET /jobs/:id — unchanged.

## Notes

- `solve_count` = `COUNT(*)` from solves per puzzle (LEFT JOIN in /puzzles).
- The existing `/submit` endpoint can stay as-is or gain the same auth.
- CORS already allows Any headers, so `Authorization` passes through.
- Run `sqlx migrate run` (DATABASE_URL=postgresql://localhost/plonktris)
  to apply migrations/; `cargo sqlx prepare` if you use offline mode.
