use axum::{Router, routing::{get, post}, Json, extract::State, extract::Path, extract::Query, extract::ConnectInfo, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::time::{Instant, Duration};
use std::net::SocketAddr;
use sqlx::PgPool;
use tower_http::cors::{CorsLayer, AllowOrigin, Any};
use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},Argon2};
use axum::http::{HeaderMap, HeaderValue, header::AUTHORIZATION};
use axum::{async_trait, extract::FromRequestParts, http::request::Parts};

mod engine;
mod validate;

struct AppState {
    db: PgPool,
    // per-IP registration timestamps, for throttling account creation
    reg_attempts: Mutex<HashMap<String, Vec<Instant>>>,
}

#[tokio::main]
async fn main() {

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgresql://localhost/plonktris".to_string());
    // Hosts and managed Postgres (Fly, Neon, ...) drop idle/old TCP connections; a bare
    // PgPool::connect would then hand out a dead one and a request fails with "got 0 bytes at
    // EOF". Ping before handing out (skip dead conns) and recycle connections well before any
    // cutoff. Small and min 0: free-tier Postgres caps connections, and holding none while idle
    // lets a scale-to-zero database actually suspend. TLS (rustls) is negotiated from the URL,
    // e.g. `?sslmode=require` for Neon.
    let db = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .min_connections(0)
        .acquire_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(120))
        .max_lifetime(Duration::from_secs(1800))
        .test_before_acquire(true)
        .connect(&database_url)
        .await.unwrap();

    println!("ready!");

    let state = Arc::new(AppState { db, reg_attempts: Mutex::new(HashMap::new()) });

    let cors = CorsLayer::new()
        .allow_methods(Any)
        .allow_headers(Any)
        .allow_origin(match std::env::var("ALLOWED_ORIGINS") {
            Ok(origins) if !origins.trim().is_empty() => AllowOrigin::list(
                origins
                    .split(',')
                    .map(|o| o.trim().parse::<HeaderValue>().expect("invalid origin in ALLOWED_ORIGINS"))
                    .collect::<Vec<_>>(),
            ),
            _ => AllowOrigin::any(),
        });

    let app = Router::new()
        .route("/health", get(|| async { "plonktris online" }))
        .route("/auth/register", post(register_account))
        .route("/auth/login", post(login_account))
        .route("/auth/logout", post(logout_account))
        .route("/auth/me", get(me))
        .route("/puzzles", get(list_puzzles).post(publish_puzzle))
        .route("/puzzles/:id", get(get_puzzle))
        .route("/puzzles/:id/solve", post(solve_puzzle))
        .route("/puzzles/:id/attempt", post(record_attempt))
        .route("/stats", get(get_stats))
        .route("/leaderboard", get(get_leaderboard))
        .route("/users/:username", get(get_user_profile))
        .layer(cors)
        .with_state(state);

    let bind_addr = bind_addr(std::env::var("BIND_ADDR").ok(), std::env::var("PORT").ok());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    println!("listening on {bind_addr}");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}

// BIND_ADDR wins (local dev / explicit config); else PORT, which most hosts set (listen on all
// interfaces); else localhost:3000.
fn bind_addr(bind_addr: Option<String>, port: Option<String>) -> String {
    let set = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    match (set(bind_addr), set(port)) {
        (Some(addr), _) => addr,
        (None, Some(port)) => format!("0.0.0.0:{port}"),
        (None, None) => "127.0.0.1:3000".to_string(),
    }
}

fn db_err(e: sqlx::Error) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}"))
}

// replay a solution against a puzzle (API formats); Err is the client-facing 400
fn check_solution(board: &[u8], queue: &[u8], requirements: &[u8], solution: &[u8]) -> Result<(), (StatusCode, String)> {
    let result = engine::replay_api(board, queue, requirements, solution);
    match result.error {
        None => Ok(()),
        Some(e) => Err((StatusCode::BAD_REQUEST, format!("solution doesn't solve this puzzle: {}", e.message()))),
    }
}

#[derive(Deserialize)]
struct PublishRequest {
    name: Option<String>,
    board: Vec<u8>,
    queue: Vec<u8>,
    requirements: Vec<u8>,
    solution: Vec<u8>,
}

#[derive(Serialize)]
struct PublishResponse {
    id: String,
}

// Publish: the creator's own solve is replayed to prove the puzzle is solvable, then stored.
async fn publish_puzzle(
    State(state): State<Arc<AppState>>,
    auth: Option<AuthUser>,
    Json(body): Json<PublishRequest>,
) -> Result<Json<PublishResponse>, (StatusCode, String)> {
    let user = auth.ok_or((StatusCode::UNAUTHORIZED, "log in to publish a puzzle".to_string()))?;

    validate::validate_puzzle(&body.board, &body.queue, &body.requirements)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let name = validate::clean_name(body.name.as_deref())
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    validate::validate_solution(&body.solution)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    check_solution(&body.board, &body.queue, &body.requirements, &body.solution)?;

    // reject exact duplicates
    let dup = sqlx::query_scalar!(
        r#"SELECT EXISTS(
            SELECT 1 FROM puzzles
            WHERE board = $1 AND queue = $2 AND requirements = $3
        ) AS "exists!""#,
        body.board,
        body.queue,
        body.requirements,
    )
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;

    if dup {
        return Err((StatusCode::CONFLICT, "an identical puzzle already exists".into()));
    }

    let r = &body.requirements;
    let id = sqlx::query_scalar!(
        "INSERT INTO puzzles (board, queue, requirements, solution, num_pieces, tss, tsd, tst, tetris, pc, attack, max_combo, no_hold, name, creator_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id",
        body.board,
        body.queue,
        body.requirements,
        body.solution,
        body.queue.len() as i32,
        r[0] as i32,
        r[1] as i32,
        r[2] as i32,
        r[3] as i32,
        r[4] as i32,
        r[5] as i32,
        r[6] as i32,
        r[7] == 1,
        name,
        user.id,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| match &e {
        // lost a race with an identical publish (puzzles_identity_idx)
        sqlx::Error::Database(db) if db.is_unique_violation() =>
            (StatusCode::CONFLICT, "an identical puzzle already exists".to_string()),
        _ => db_err(e),
    })?;

    Ok(Json(PublishResponse { id: id.to_string() }))
}

#[derive(Deserialize)]
struct SolveRequest {
    solution: Vec<u8>,
}

#[derive(Serialize)]
struct SolveResponse {
    new_solve: bool,    // recorded now: first time this user solved it, and they're not the creator
    first_solve: bool,  // ...and it's the puzzle's first-ever solve
    solve_count: i64,
}

// Solve: replay against the stored puzzle; record it unless it's the creator or a repeat.
async fn solve_puzzle(
    State(state): State<Arc<AppState>>,
    Path(puzzle_id): Path<uuid::Uuid>,
    auth: Option<AuthUser>,
    Json(body): Json<SolveRequest>,
) -> Result<Json<SolveResponse>, (StatusCode, String)> {
    let user = auth.ok_or((StatusCode::UNAUTHORIZED, "log in to record a solve".to_string()))?;
    validate::validate_solution(&body.solution)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let p = sqlx::query!(
        "SELECT board, queue, requirements, creator_id FROM puzzles WHERE id = $1",
        puzzle_id
    )
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or((StatusCode::NOT_FOUND, "puzzle not found".to_string()))?;

    if !validate::replayable(&p.board, &p.queue, &p.requirements) {
        return Err((StatusCode::INTERNAL_SERVER_ERROR, "this puzzle's stored data is malformed".into()));
    }
    check_solution(&p.board, &p.queue, &p.requirements, &body.solution)?;

    // the creator's solves verify but aren't recorded
    if user.id == p.creator_id {
        let solve_count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "n!" FROM solves WHERE puzzle_id = $1"#, puzzle_id
        ).fetch_one(&state.db).await.map_err(db_err)?;
        return Ok(Json(SolveResponse { new_solve: false, first_solve: false, solve_count }));
    }

    let mut tx = state.db.begin().await.map_err(db_err)?;
    // Serialise solves of this puzzle so exactly one of two simultaneous solvers gets the first
    // solve. (NO KEY UPDATE doesn't block the FK checks of inserts into solves/attempts.)
    sqlx::query!("SELECT id FROM puzzles WHERE id = $1 FOR NO KEY UPDATE", puzzle_id)
        .fetch_one(&mut *tx).await.map_err(db_err)?;
    // a repeat solve hits the unique (puzzle_id, user_id) constraint and returns no row
    let inserted = sqlx::query_scalar!(
        "INSERT INTO solves (puzzle_id, user_id, solution, first_solve)
         VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM solves WHERE puzzle_id = $1))
         ON CONFLICT (puzzle_id, user_id) DO NOTHING
         RETURNING first_solve",
        puzzle_id,
        user.id,
        body.solution,
    )
    .fetch_optional(&mut *tx).await.map_err(db_err)?;
    let solve_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "n!" FROM solves WHERE puzzle_id = $1"#, puzzle_id
    ).fetch_one(&mut *tx).await.map_err(db_err)?;
    tx.commit().await.map_err(db_err)?;

    Ok(Json(SolveResponse {
        new_solve: inserted.is_some(),
        first_solve: inserted.unwrap_or(false),
        solve_count,
    }))
}

#[derive(Deserialize)]
struct AccountRequest {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct UserInfo {
    id: String,
    username: String,
}

#[derive(Serialize)]
struct AuthResponse {
    token: String,
    user: UserInfo,
}

struct AuthUser {
    id: uuid::Uuid,
    username: String,
    token: uuid::Uuid,
}

#[async_trait]
impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = (StatusCode, String);

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(&parts.headers)?;

        let row = sqlx::query!(
            "SELECT users.id, users.username
             FROM sessions JOIN users ON users.id = sessions.user_id
             WHERE sessions.token = $1",
            token
        )
        .fetch_optional(&state.db)
        .await
        .map_err(db_err)?
        .ok_or((StatusCode::UNAUTHORIZED, "invalid token".to_string()))?;

        Ok(AuthUser { id: row.id, username: row.username, token })
    }
}

fn bearer_token(headers: &HeaderMap) -> Result<uuid::Uuid, (StatusCode, String)> {
    let value = headers
        .get(AUTHORIZATION)                       // Option<&HeaderValue>
        .and_then(|v| v.to_str().ok())            // header bytes → &str
        .ok_or((StatusCode::UNAUTHORIZED, "missing token".to_string()))?;

    let token_str = value
        .strip_prefix("Bearer ")
        .ok_or((StatusCode::UNAUTHORIZED, "invalid auth header".to_string()))?;

    token_str.parse()
        .map_err(|_| (StatusCode::UNAUTHORIZED, "invalid token".to_string()))
}


// first X-Forwarded-For hop (set by the proxy), else the socket peer
fn client_ip(headers: &HeaderMap, addr: SocketAddr) -> String {
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| addr.ip().to_string())
}

async fn register_account(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<AccountRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    // per-IP throttle, before the expensive argon2 hash so floods are cheap to reject
    const MAX_REGISTRATIONS_PER_IP_HOUR: usize = 5;
    {
        let ip = client_ip(&headers, addr);
        let now = Instant::now();
        let mut map = state.reg_attempts.lock().unwrap();
        let entry = map.entry(ip).or_default();
        entry.retain(|t| now.duration_since(*t) < Duration::from_secs(3600));
        if entry.len() >= MAX_REGISTRATIONS_PER_IP_HOUR {
            return Err((StatusCode::TOO_MANY_REQUESTS,
                "too many accounts created from here — try again later".into()));
        }
        entry.push(now);
    }

    if body.username.is_empty() || body.username.len() > 32 {
        return Err((StatusCode::BAD_REQUEST, "username must be 1-32 characters".into()));
    }
    if !body.username.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err((StatusCode::BAD_REQUEST, "username: letters, numbers, _ and - only".into()));
    }
    if rustrict::CensorStr::is_inappropriate(body.username.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "pick a different username".into()));
    }
    if body.password.len() < 8 || body.password.len() > 128 {
        return Err((StatusCode::BAD_REQUEST, "password must be 8-128 characters".into()));
    }
    if body.password.eq_ignore_ascii_case(&body.username) {
        return Err((StatusCode::BAD_REQUEST, "password cannot be your username".into()));
    }

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("hash error: {e}")))?
        .to_string();

    let user_id = sqlx::query_scalar!(
        "INSERT INTO users (username, password_hash)
         VALUES (LOWER($1), $2)
         RETURNING id",
        body.username,
        password_hash,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() =>
            (StatusCode::CONFLICT, "username already taken".to_string()),
        _ => db_err(e),
    })?;

    let token = sqlx::query_scalar!(
        "INSERT INTO sessions (user_id)
         VALUES ($1)
         RETURNING token",
        user_id,
    )
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(AuthResponse {
        token: token.to_string(),
        user: UserInfo { id: user_id.to_string(), username: body.username },
    }))
}

async fn login_account(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AccountRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
    let row = sqlx::query!(
        "SELECT password_hash, id FROM users WHERE LOWER(username) = LOWER($1)",
        body.username,
    ).fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or((StatusCode::UNAUTHORIZED, "invalid credentials".to_string()))?;

    let parsed_hash = PasswordHash::new(&row.password_hash)
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("hash error: {e}")))?;

    if Argon2::default().verify_password(body.password.as_bytes(), &parsed_hash).is_err() {
        return Err((StatusCode::UNAUTHORIZED, "invalid credentials".into()));
    }

    let token = sqlx::query_scalar!(
        "INSERT INTO sessions (user_id)
         VALUES ($1)
         RETURNING token",
        row.id,
    )
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(AuthResponse {
        token: token.to_string(),
        user: UserInfo { id: row.id.to_string(), username: body.username },
    }))
}


async fn logout_account(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {

    sqlx::query!(
        "DELETE FROM sessions WHERE token = $1",
        auth.token,
    )
    .execute(&state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(serde_json::json!({})))
}

async fn me(auth: AuthUser) -> Json<UserInfo> {
    Json(UserInfo { id: auth.id.to_string(), username: auth.username })
}

#[derive(Serialize)]
struct PuzzleInfo {
    id: String,
    name: String,
    creator: Option<String>,
    board: Vec<u8>,
    queue: Vec<u8>,
    requirements: Vec<u8>,
    num_pieces: i32,
    solve_count: i64,
    attempt_count: i64,
    created_at: String,
    solved_by_me: bool,  // false when anonymous
}

#[derive(Deserialize)]
struct PuzzleQuery {
    q: Option<String>,
    min_pieces: Option<i32>,
    max_pieces: Option<i32>,
    solved: Option<String>,  // 'solved' (ever solved) | 'unsolved' (never)
    sort: Option<String>,    // 'solves' (most solved) | else newest
    reqs: Option<String>,    // comma list: tspin,tetris,pc,attack,combo,nohold
    featured: Option<bool>,  // only editorially-featured puzzles
    limit: Option<i64>,      // cap result count (used by the home dashboard rails)
}

async fn list_puzzles(
    State(state): State<Arc<AppState>>,
    auth: Option<AuthUser>,
    Query(query): Query<PuzzleQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let viewer = auth.map(|a| a.id);
    // normalize: blank search / unknown enum values become None (no filter)
    let q = query.q.filter(|s| !s.trim().is_empty());
    let solved = query.solved.filter(|s| s == "solved" || s == "unsolved");

    // requirement checkboxes: AND-combined, each narrows the result set
    let reqs = query.reqs.unwrap_or_default();
    let reqs: std::collections::HashSet<&str> = reqs.split(',').map(|s| s.trim()).collect();
    let want_tspin  = reqs.contains("tspin");
    let want_tetris = reqs.contains("tetris");
    let want_pc     = reqs.contains("pc");
    let want_attack = reqs.contains("attack");
    let want_combo  = reqs.contains("combo");
    let want_nohold = reqs.contains("nohold");
    let want_featured = query.featured.unwrap_or(false);

    let rows = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(DISTINCT s.id) AS "solve_count!",
                  COUNT(DISTINCT a.id) AS "attempt_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!",
                  EXISTS(SELECT 1 FROM solves ms WHERE ms.puzzle_id = p.id AND ms.user_id = $14) AS "solved_by_me!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           LEFT JOIN attempts a ON a.puzzle_id = p.id
           WHERE ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%')
             AND ($2::int IS NULL OR p.num_pieces >= $2)
             AND ($3::int IS NULL OR p.num_pieces <= $3)
             AND (NOT $6::bool OR (p.tss > 0 OR p.tsd > 0 OR p.tst > 0))
             AND (NOT $7::bool OR p.tetris > 0)
             AND (NOT $8::bool OR p.pc > 0)
             AND (NOT $9::bool OR p.attack > 0)
             AND (NOT $10::bool OR p.max_combo > 0)
             AND (NOT $11::bool OR p.no_hold)
             AND (NOT $12::bool OR p.featured)
           GROUP BY p.id, u.username
           HAVING ($4::text IS NULL
                   OR ($4 = 'solved'   AND COUNT(DISTINCT s.id) > 0)
                   OR ($4 = 'unsolved' AND COUNT(DISTINCT s.id) = 0))
           ORDER BY
             CASE WHEN $5::text = 'solves' THEN COUNT(DISTINCT s.id) END DESC NULLS LAST,
             p.created_at DESC
           LIMIT $13"#,
        q,
        query.min_pieces,
        query.max_pieces,
        solved,
        query.sort,
        want_tspin,
        want_tetris,
        want_pc,
        want_attack,
        want_combo,
        want_nohold,
        want_featured,
        query.limit,
        viewer,
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;

    let puzzles: Vec<PuzzleInfo> = rows.into_iter().map(|r| PuzzleInfo {
        id: r.id.to_string(),
        name: r.name,
        creator: r.creator,
        board: r.board,
        queue: r.queue,
        requirements: r.requirements,
        num_pieces: r.num_pieces,
        solve_count: r.solve_count,
        attempt_count: r.attempt_count,
        created_at: r.created_at,
        solved_by_me: r.solved_by_me,
    }).collect();

    Ok(Json(serde_json::json!({ "puzzles": puzzles })))
}

// Record that a logged-in user opened a puzzle. Idempotent per (puzzle, user) via the unique
// constraint, and the creator's own opens don't count — so attempt_count mirrors solve_count.
async fn record_attempt(
    State(state): State<Arc<AppState>>,
    Path(puzzle_id): Path<uuid::Uuid>,
    auth: AuthUser,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    sqlx::query!(
        "INSERT INTO attempts (puzzle_id, user_id)
         SELECT $1, $2 FROM puzzles WHERE id = $1 AND creator_id <> $2
         ON CONFLICT (puzzle_id, user_id) DO NOTHING",
        puzzle_id,
        auth.id,
    )
    .execute(&state.db).await
    .map_err(db_err)?;
    Ok(Json(serde_json::json!({})))
}

async fn get_puzzle(
    State(state): State<Arc<AppState>>,
    auth: Option<AuthUser>,
    Path(puzzle_id): Path<uuid::Uuid>,
) -> Result<Json<PuzzleInfo>, (StatusCode, String)> {
    let viewer = auth.map(|a| a.id);
    let r = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(DISTINCT s.id) AS "solve_count!",
                  COUNT(DISTINCT a.id) AS "attempt_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!",
                  EXISTS(SELECT 1 FROM solves ms WHERE ms.puzzle_id = p.id AND ms.user_id = $2) AS "solved_by_me!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           LEFT JOIN attempts a ON a.puzzle_id = p.id
           WHERE p.id = $1
           GROUP BY p.id, u.username"#,
        puzzle_id,
        viewer,
    )
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or((StatusCode::NOT_FOUND, "puzzle not found".to_string()))?;

    Ok(Json(PuzzleInfo {
        id: r.id.to_string(),
        name: r.name,
        creator: r.creator,
        board: r.board,
        queue: r.queue,
        requirements: r.requirements,
        num_pieces: r.num_pieces,
        solve_count: r.solve_count,
        attempt_count: r.attempt_count,
        created_at: r.created_at,
        solved_by_me: r.solved_by_me,
    }))
}

#[derive(Serialize)]
struct SiteStats {
    puzzles: i64,
    solves: i64,
    users: i64,
}

async fn get_stats(
    State(state): State<Arc<AppState>>,
) -> Result<Json<SiteStats>, (StatusCode, String)> {
    let r = sqlx::query!(
        r#"SELECT
              (SELECT COUNT(*) FROM puzzles) AS "puzzles!",
              (SELECT COUNT(*) FROM solves)  AS "solves!",
              (SELECT COUNT(*) FROM users)   AS "users!""#
    )
    .fetch_one(&state.db)
    .await
    .map_err(db_err)?;

    Ok(Json(SiteStats { puzzles: r.puzzles, solves: r.solves, users: r.users }))
}

#[derive(Serialize)]
struct LeaderEntry {
    username: String,
    solves: i64,
    first_solves: i64,
}

async fn get_leaderboard(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let rows = sqlx::query!(
        r#"SELECT u.username,
                  COUNT(s.id) AS "solves!",
                  COUNT(s.id) FILTER (WHERE s.first_solve) AS "first_solves!"
           FROM users u
           JOIN solves s ON s.user_id = u.id
           GROUP BY u.username
           ORDER BY COUNT(s.id) DESC, COUNT(s.id) FILTER (WHERE s.first_solve) DESC
           LIMIT 10"#
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?;

    let leaders: Vec<LeaderEntry> = rows.into_iter().map(|r| LeaderEntry {
        username: r.username,
        solves: r.solves,
        first_solves: r.first_solves,
    }).collect();

    Ok(Json(serde_json::json!({ "leaders": leaders })))
}

#[derive(Serialize)]
struct UserProfile {
    username: String,
    created_at: String,
    created: Vec<PuzzleInfo>,
    solved: Vec<PuzzleInfo>,
}

async fn get_user_profile(
    State(state): State<Arc<AppState>>,
    auth: Option<AuthUser>,
    Path(username): Path<String>,
) -> Result<Json<UserProfile>, (StatusCode, String)> {
    let viewer = auth.map(|a| a.id);
    let user = sqlx::query!(
        r#"SELECT id, username,
                  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!"
           FROM users WHERE LOWER(username) = LOWER($1)"#,
        username
    )
    .fetch_optional(&state.db)
    .await
    .map_err(db_err)?
    .ok_or((StatusCode::NOT_FOUND, "user not found".to_string()))?;

    let created = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(DISTINCT s.id) AS "solve_count!",
                  COUNT(DISTINCT a.id) AS "attempt_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!",
                  EXISTS(SELECT 1 FROM solves ms WHERE ms.puzzle_id = p.id AND ms.user_id = $2) AS "solved_by_me!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           LEFT JOIN attempts a ON a.puzzle_id = p.id
           WHERE p.creator_id = $1
           GROUP BY p.id, u.username
           ORDER BY p.created_at DESC"#,
        user.id,
        viewer,
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?
    .into_iter().map(|r| PuzzleInfo {
        id: r.id.to_string(), name: r.name, creator: r.creator,
        board: r.board, queue: r.queue, requirements: r.requirements,
        num_pieces: r.num_pieces, solve_count: r.solve_count, attempt_count: r.attempt_count, created_at: r.created_at,
        solved_by_me: r.solved_by_me,
    }).collect();

    let solved = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(DISTINCT s.id) AS "solve_count!",
                  COUNT(DISTINCT a.id) AS "attempt_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!",
                  EXISTS(SELECT 1 FROM solves ms WHERE ms.puzzle_id = p.id AND ms.user_id = $2) AS "solved_by_me!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           LEFT JOIN attempts a ON a.puzzle_id = p.id
           WHERE p.id IN (SELECT puzzle_id FROM solves WHERE user_id = $1)
           GROUP BY p.id, u.username
           ORDER BY p.created_at DESC"#,
        user.id,
        viewer,
    )
    .fetch_all(&state.db)
    .await
    .map_err(db_err)?
    .into_iter().map(|r| PuzzleInfo {
        id: r.id.to_string(), name: r.name, creator: r.creator,
        board: r.board, queue: r.queue, requirements: r.requirements,
        num_pieces: r.num_pieces, solve_count: r.solve_count, attempt_count: r.attempt_count, created_at: r.created_at,
        solved_by_me: r.solved_by_me,
    }).collect();

    Ok(Json(UserProfile {
        username: user.username,
        created_at: user.created_at,
        created,
        solved,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_addr_precedence() {
        let s = |v: &str| Some(v.to_string());
        assert_eq!(bind_addr(None, None), "127.0.0.1:3000");
        assert_eq!(bind_addr(None, s("8080")), "0.0.0.0:8080");
        assert_eq!(bind_addr(s("0.0.0.0:3000"), s("8080")), "0.0.0.0:3000");
        assert_eq!(bind_addr(s(" "), s("8080")), "0.0.0.0:8080");
    }

    #[test]
    fn replay_failure_messages() {
        let board = vec![0u8; 210];
        let reqs = [1, 0, 0, 0, 0, 0, 0, 0]; // one TSS
        let msg = |sol: &[u8]| check_solution(&board, &[2], &reqs, sol).unwrap_err();
        assert_eq!(msg(&[9]), (StatusCode::BAD_REQUEST, "solution doesn't solve this puzzle: invalid action".into()));
        assert_eq!(msg(&[]).1, "solution doesn't solve this puzzle: not every piece was placed");
        assert_eq!(msg(&[6, 0]).1, "solution doesn't solve this puzzle: moves after the last piece");
        assert_eq!(msg(&[6]).1, "solution doesn't solve this puzzle: requirements not met");
        // a column in the spawn area: the second piece can't spawn
        let mut tall = vec![0u8; 210];
        for r in 2..21 {
            tall[r * 10 + 4] = 1;
        }
        assert_eq!(check_solution(&tall, &[2, 2], &reqs, &[6, 6]).unwrap_err().1,
            "solution doesn't solve this puzzle: topped out");
    }
}
