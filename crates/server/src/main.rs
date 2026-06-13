use axum::{Router, routing::{get, post}, Json, extract::State, extract::Path, extract::Query, extract::ConnectInfo, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::time::{Instant, Duration};
use std::net::SocketAddr;
use sqlx::PgPool;
use plonky2::{field::goldilocks_field::GoldilocksField, util::serialization::DefaultGateSerializer};
use plonky2::plonk::{config::PoseidonGoldilocksConfig, proof::ProofWithPublicInputs};
use plonky2::plonk::circuit_data::{CommonCircuitData, VerifierOnlyCircuitData, VerifierCircuitData};
use tokio::sync::Notify;
use circuit::generate_proof;
use tower_http::cors::{CorsLayer, Any};
use argon2::{password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},Argon2};
use axum::http::{HeaderMap, header::AUTHORIZATION};
use axum::{async_trait, extract::FromRequestParts, http::request::Parts};


struct AppState {
    db: PgPool,
    verifiers: Arc<Vec<VerifierData>>,
    new_job: Notify,
    // per-IP registration timestamps, for throttling account creation
    reg_attempts: Mutex<HashMap<String, Vec<Instant>>>,
}

#[tokio::main]
async fn main() {

    let db = PgPool::connect("postgresql://localhost/plonktris")
    .await.unwrap();

    println!("loading verifiers...");
    let verifiers = Arc::new(load_verifiers());
    println!("ready!");

    let state = Arc::new(AppState { db: db, verifiers: verifiers, new_job: Notify::new(), reg_attempts: Mutex::new(HashMap::new()) });
    let worker_state = state.clone();

    tokio::spawn(async move {
        loop { 
            match process_next_job(&worker_state).await {
                Ok(true) => {}
                Ok(false) => {worker_state.new_job.notified().await;}
                Err(e) => {
                    eprintln!("worker error: {e}");
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }

        }
    });

    let app = Router::new()
        .route("/health", get(|| async { "plonktris online" }))
        .route("/request", post(request_proof))
        .route("/submit", post(submit_proof_json))
        .route("/jobs/:id", get(get_job_status))
        .route("/auth/register", post(register_account))
        .route("/auth/login", post(login_account))
        .route("/auth/logout", post(logout_account))
        .route("/auth/me", get(me))
        .route("/puzzles", get(list_puzzles))
        .route("/puzzles/:id", get(get_puzzle))
        .route("/stats", get(get_stats))
        .route("/leaderboard", get(get_leaderboard))
        .route("/users/:username", get(get_user_profile))
        .layer(CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any))
        .with_state(state);

    // localhost by default (TLS-terminating proxy in front); set BIND_ADDR=0.0.0.0:3000 for container hosts
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".to_string());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    println!("listening on {bind_addr}");
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}

#[derive(Deserialize)]
struct SubmitProofRequest {
    actions: Vec<u8>,
    board: Vec<u8>,
    queue: Vec<u8>,
    requirements: Vec<u8>,
    name: Option<String>,             // publish mode
    puzzle_id: Option<uuid::Uuid>,    // solve mode
}

async fn request_proof(
    State(state): State<Arc<AppState>>,
    auth: Option<AuthUser>,
    Json(body): Json<SubmitProofRequest>
) -> Result<Json<SubmitVerificationResponse>, (StatusCode, String)> {
    let num_pieces = body.queue.len();
    let mut req_counter = 0;
    if num_pieces < 1 || num_pieces > 21 {
        return Err((StatusCode::BAD_REQUEST, "num_pieces must be between 1 and 21".into()));
    }
    for req in 0..7 {
        req_counter += body.requirements[req];
    }
    if req_counter == 0 {
        return Err((StatusCode::BAD_REQUEST, "must have requirements".into()));
    }

    let user_id = auth.map(|a| a.id);

    let name = if let Some(target) = body.puzzle_id {
        let p = sqlx::query!(
            "SELECT board, queue, requirements FROM puzzles WHERE id = $1",
            target
        )
        .fetch_optional(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
        .ok_or((StatusCode::NOT_FOUND, "puzzle not found".to_string()))?;

        if p.board != body.board || p.queue != body.queue || p.requirements != body.requirements {
            return Err((StatusCode::BAD_REQUEST, "inputs don't match the puzzle".into()));
        }
        // anonymous solves aren't recorded, so don't burn the prover on them
        if user_id.is_none() {
            return Err((StatusCode::UNAUTHORIZED, "log in to record a solve".into()));
        }
        None
    } else {
        if user_id.is_none() {
            return Err((StatusCode::UNAUTHORIZED, "log in to publish a puzzle".into()));
        }

        //puzzle name moderation
        let n = body.name.unwrap_or_default().trim().to_string();
        let n = if n.is_empty() { "untitled".to_string() } else { n };
        if n.len() > 64 {
            return Err((StatusCode::BAD_REQUEST, "name must be at most 64 characters".into()));
        }
        if rustrict::CensorStr::is_inappropriate(n.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "pick a different puzzle name".into()));
        }

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
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

        if dup {
            return Err((StatusCode::CONFLICT, "an identical puzzle already exists".into()));
        }
        Some(n)
    };

    // over any limit, a 429 tells the client to fall back to in-browser proving
    const MAX_QUEUE_GLOBAL: i64 = 32;  // total jobs queued/proving across all users
    const MAX_INFLIGHT: i64 = 2;       // per-user jobs pending/proving at once
    const MAX_PER_HOUR: i64 = 10;      // per-user server proofs per rolling hour

    // global cap bounds total load regardless of how many accounts an attacker makes
    let queue_depth = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "n!" FROM jobs WHERE status IN ('pending','proving')"#
    ).fetch_one(&state.db).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;
    if queue_depth >= MAX_QUEUE_GLOBAL {
        return Err((StatusCode::TOO_MANY_REQUESTS,
            "the prover is busy — prove securely in your browser".into()));
    }

    if let Some(uid) = user_id {
        let inflight = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "n!" FROM jobs WHERE user_id = $1 AND status IN ('pending','proving')"#,
            uid
        ).fetch_one(&state.db).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;
        let recent = sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "n!" FROM jobs WHERE user_id = $1 AND submitted > now() - interval '1 hour'"#,
            uid
        ).fetch_one(&state.db).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;
        if inflight >= MAX_INFLIGHT || recent >= MAX_PER_HOUR {
            return Err((StatusCode::TOO_MANY_REQUESTS,
                "fast proving limit reached — prove securely in your browser".into()));
        }
    }

    let id = sqlx::query_scalar!(
        "INSERT INTO jobs (board, queue, requirements, actions, user_id, name, target_puzzle_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id",
        body.board,
        body.queue,
        body.requirements,
        body.actions,
        user_id,
        name,
        body.puzzle_id,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

    state.new_job.notify_one();

    Ok(Json(SubmitVerificationResponse {
        success: true,
        proof_id: id.to_string(),
    }))
}

async fn process_next_job(worker_state: &Arc<AppState>) -> Result<bool, String> {
    let job = sqlx::query!(
        "SELECT id, board, queue, requirements, actions, user_id, name, target_puzzle_id
        FROM jobs
        WHERE status = 'pending'
        ORDER BY submitted ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED",
    )
    .fetch_optional(&worker_state.db).await.map_err(|e| format!("db error: {e}"))?;

    if let Some(job) = job {
        sqlx::query!("UPDATE jobs SET status = 'proving' WHERE id = $1", job.id)
        .execute(&worker_state.db).await.map_err(|e| format!("db error: {e}"))?;
        let board = job.board.clone();
        let queue = job.queue.clone();
        let requirements = job.requirements.clone();
        let secret_moves = job.actions.unwrap().clone();

        let (tx, rx) = tokio::sync::oneshot::channel();

        std::thread::spawn(move || {
            let _ = tx.send(generate_proof(&board, &queue, &requirements, &secret_moves));
        });

        match rx.await {
            Ok(Ok(proof_bytes)) => {
                let outcome = if let Some(target) = job.target_puzzle_id {
                    record_solve(worker_state, proof_bytes, &job.board, &job.queue,
                        &job.requirements, target, job.user_id).await
                } else {
                    let body = SubmitVerificationRequest {
                        proof: proof_bytes,
                        board: job.board,
                        queue: job.queue,
                        requirements: job.requirements,
                        name: None,
                        puzzle_id: None,
                    };
                    submit_proof(worker_state.clone(), body, job.user_id,
                        job.name.unwrap_or_else(|| "untitled".to_string())).await
                };
                match outcome {
                    Ok(puzzle_id) => {
                        sqlx::query!("UPDATE jobs SET status = 'done', actions = NULL, puzzle_id = $2
                        WHERE id = $1", job.id, puzzle_id)
                        .execute(&worker_state.db).await.map_err(|e| format!("db error: {e}"))?;
                    }
                    Err(e) => {
                        sqlx::query!("UPDATE jobs SET status = 'failed', failed_reason = $2, actions = NULL
                        WHERE id = $1", job.id, e)
                        .execute(&worker_state.db).await.map_err(|e| format!("db error: {e}"))?;
                    }
                }
            }
            Ok(Err(e)) => {
                sqlx::query!("UPDATE jobs SET status = 'failed', failed_reason = $2, actions = NULL 
                WHERE id = $1", job.id, e)
                .execute(&worker_state.db).await.map_err(|e| format!("db error: {e}"))?;    
            }
            Err(e) => {
                sqlx::query!("UPDATE jobs SET status = 'failed', failed_reason = $2, actions = NULL 
                WHERE id = $1", job.id, format!("thread error: {}", e))
                .execute(&worker_state.db).await.map_err(|e| format!("db error: {e}"))?;
            }
        }
    } else {
        return Ok(false);
    }
Ok(true)
}

#[derive(Serialize)]
struct JobStatusResponse {
    status: String,
    puzzle_id: Option<String>,
    failed_reason: Option<String>,
}

async fn get_job_status(
    State(state): State<Arc<AppState>>,
    Path(job_id): Path<uuid::Uuid>,
) -> Result<Json<JobStatusResponse>, (StatusCode, String)> {
    let job = sqlx::query!(
        "SELECT status, puzzle_id, failed_reason FROM jobs WHERE id = $1",
        job_id
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
    .ok_or((StatusCode::NOT_FOUND, "job not found".to_string()))?;

    Ok(Json(JobStatusResponse {
        status: job.status,
        puzzle_id: job.puzzle_id.map(|id| id.to_string()),
        failed_reason: job.failed_reason,
    }))
}


#[derive(Deserialize)]
struct SubmitVerificationRequest {
    proof: Vec<u8>,
    board: Vec<u8>,
    queue: Vec<u8>,
    requirements: Vec<u8>,
    name: Option<String>,             // publish mode (client-side proving)
    puzzle_id: Option<uuid::Uuid>,    // solve mode (client-side proving)
}

#[derive(Serialize)]
struct SubmitVerificationResponse {
    success: bool,
    proof_id: String,
}

// verify proof bytes against the verifier for this queue length
fn verify_proof(state: &AppState, proof: &[u8], num_pieces: usize) -> Result<(), String> {
    if num_pieces < 1 || num_pieces > 21 {
        return Err(format!("num_pieces must be between 1 and 21"));
    }
    let (verifier_only, common) = &state.verifiers[num_pieces - 1];
    let verifier = VerifierCircuitData {
        verifier_only: verifier_only.clone(),
        common: common.clone(),
    };

    let parsed = ProofWithPublicInputs::<GoldilocksField, PoseidonGoldilocksConfig, 2>::from_bytes(
        proof.to_vec(),
        common
    ).map_err(|e| format!("invalid proof bytes: {e}"))?;

    verifier.verify(parsed)
    .map_err(|e| format!("proof verification failed: {e}"))
}

async fn submit_proof(
    state: Arc<AppState>,
    body: SubmitVerificationRequest,
    creator_id: Option<uuid::Uuid>,
    name: String,
) -> Result<uuid::Uuid, String>  {
    let num_pieces = body.queue.len();
    let tss = body.requirements[0] as i32;
    let tsd = body.requirements[1] as i32;
    let tst = body.requirements[2] as i32;
    let tetris = body.requirements[3] as i32;
    let pc = body.requirements[4] as i32;
    let attack = body.requirements[5] as i32;
    let max_combo = body.requirements[6] as i32;
    let no_hold = body.requirements[7] == 1;

    let mut req_counter = 0;
    for req in 0..7 {
        req_counter += body.requirements[req];
    }
    if req_counter == 0 {
        return Err(format!("must have requirements"))
    }

    verify_proof(&state, &body.proof, num_pieces)?;

    let id = sqlx::query_scalar!(
        "INSERT INTO puzzles (proof, board, queue, requirements, num_pieces, tss, tsd, tst, attack, pc, tetris, max_combo, no_hold, name, creator_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id",
        body.proof,
        body.board,
        body.queue,
        body.requirements,
        num_pieces as i32,
        tss,
        tsd,
        tst,
        attack,
        pc,
        tetris,
        max_combo,
        no_hold,
        name,
        creator_id,
    )
    .fetch_one(&state.db).await.map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() =>
            "an identical puzzle already exists".to_string(),
        _ => format!("db error: {e}"),
    })?;

    Ok(id)
}

async fn record_solve(
    state: &Arc<AppState>,
    proof: Vec<u8>,
    board: &[u8],
    queue: &[u8],
    requirements: &[u8],
    target: uuid::Uuid,
    user_id: Option<uuid::Uuid>,
) -> Result<uuid::Uuid, String> {
    verify_proof(state, &proof, queue.len())?;

    let p = sqlx::query!(
        "SELECT board, queue, requirements FROM puzzles WHERE id = $1",
        target
    )
    .fetch_optional(&state.db).await.map_err(|e| format!("db error: {e}"))?
    .ok_or("puzzle not found".to_string())?;

    if p.board != board || p.queue != queue || p.requirements != requirements {
        return Err("inputs don't match the puzzle".to_string());
    }

    // anonymous solves verify but aren't recorded
    if let Some(user_id) = user_id {
        sqlx::query!("INSERT INTO solves (puzzle_id, user_id) VALUES ($1, $2) 
        ON CONFLICT (puzzle_id, user_id) DO NOTHING",
            target,
            user_id,
        )
        .execute(&state.db).await.map_err(|e| format!("db error: {e}"))?;
        sqlx::query!("UPDATE solves SET first_solve = true 
        WHERE puzzle_id = $1 AND (SELECT COUNT(*) FROM solves WHERE puzzle_id = $1) = 1",
            target,
        )
        .execute(&state.db).await.map_err(|e| format!("db error: {e}"))?;
    }

    Ok(target)
}

// client-side proving: browser sends a finished proof, server only verifies + records
async fn submit_proof_json(
    State(state): State<Arc<AppState>>,
    auth: Option<AuthUser>,
    Json(body): Json<SubmitVerificationRequest>,
) -> Result<Json<SubmitVerificationResponse>, (StatusCode, String)> {
    let num_pieces = body.queue.len();
    if num_pieces < 1 || num_pieces > 21 {
        return Err((StatusCode::BAD_REQUEST, "num_pieces must be between 1 and 21".into()));
    }
    let user_id = auth.map(|a| a.id);

    let id = if let Some(target) = body.puzzle_id {
        // solve mode — recording requires login (anonymous solves aren't recorded)
        if user_id.is_none() {
            return Err((StatusCode::UNAUTHORIZED, "log in to record a solve".into()));
        }
        record_solve(&state, body.proof, &body.board, &body.queue, &body.requirements, target, user_id)
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, e))?
    } else {
        // publish mode — requires login + name moderation
        if user_id.is_none() {
            return Err((StatusCode::UNAUTHORIZED, "log in to publish a puzzle".into()));
        }
        let n = body.name.clone().unwrap_or_default().trim().to_string();
        let n = if n.is_empty() { "untitled".to_string() } else { n };
        if n.len() > 64 {
            return Err((StatusCode::BAD_REQUEST, "name must be at most 64 characters".into()));
        }
        if rustrict::CensorStr::is_inappropriate(n.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "pick a different puzzle name".into()));
        }
        submit_proof(state, body, user_id, n).await
            .map_err(|e| (StatusCode::BAD_REQUEST, e))?
    };

    Ok(Json(SubmitVerificationResponse {
        success: true,
        proof_id: id.to_string(),
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
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
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
        _ => (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")),
    })?;

    let token = sqlx::query_scalar!(
        "INSERT INTO sessions (user_id)
         VALUES ($1)
         RETURNING token",
        user_id,
    )
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

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
    created_at: String,
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
    Query(query): Query<PuzzleQuery>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
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
                  COUNT(s.id) AS "solve_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
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
                   OR ($4 = 'solved'   AND COUNT(s.id) > 0)
                   OR ($4 = 'unsolved' AND COUNT(s.id) = 0))
           ORDER BY
             CASE WHEN $5::text = 'solves' THEN COUNT(s.id) END DESC NULLS LAST,
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
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

    let puzzles: Vec<PuzzleInfo> = rows.into_iter().map(|r| PuzzleInfo {
        id: r.id.to_string(),
        name: r.name,
        creator: r.creator,
        board: r.board,
        queue: r.queue,
        requirements: r.requirements,
        num_pieces: r.num_pieces,
        solve_count: r.solve_count,
        created_at: r.created_at,
    }).collect();

    Ok(Json(serde_json::json!({ "puzzles": puzzles })))
}

async fn get_puzzle(
    State(state): State<Arc<AppState>>,
    Path(puzzle_id): Path<uuid::Uuid>,
) -> Result<Json<PuzzleInfo>, (StatusCode, String)> {
    let r = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(s.id) AS "solve_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           WHERE p.id = $1
           GROUP BY p.id, u.username"#,
        puzzle_id
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
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
        created_at: r.created_at,
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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

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
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?;

    let leaders: Vec<LeaderEntry> = rows.into_iter().map(|r| LeaderEntry {
        username: r.username,
        solves: r.solves,
        first_solves: r.first_solves,
    }).collect();

    Ok(Json(serde_json::json!({ "leaders": leaders })))
}

#[derive(Serialize)]
struct JobInfo {
    id: String,
    status: String,            // pending | proving | failed
    kind: String,              // "publish" | "solve"
    name: String,              // puzzle name (publish) or target name (solve)
    failed_reason: Option<String>,
    submitted_at: String,
}

#[derive(Serialize)]
struct UserProfile {
    username: String,
    created_at: String,
    created: Vec<PuzzleInfo>,
    solved: Vec<PuzzleInfo>,
    pending: Vec<JobInfo>,     // only populated when viewing your own profile
}

async fn get_user_profile(
    State(state): State<Arc<AppState>>,
    auth: Option<AuthUser>,
    Path(username): Path<String>,
) -> Result<Json<UserProfile>, (StatusCode, String)> {
    let user = sqlx::query!(
        r#"SELECT id, username,
                  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!"
           FROM users WHERE LOWER(username) = LOWER($1)"#,
        username
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
    .ok_or((StatusCode::NOT_FOUND, "user not found".to_string()))?;

    let is_owner = auth.map(|a| a.id) == Some(user.id);

    let created = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(s.id) AS "solve_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           WHERE p.creator_id = $1
           GROUP BY p.id, u.username
           ORDER BY p.created_at DESC"#,
        user.id
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
    .into_iter().map(|r| PuzzleInfo {
        id: r.id.to_string(), name: r.name, creator: r.creator,
        board: r.board, queue: r.queue, requirements: r.requirements,
        num_pieces: r.num_pieces, solve_count: r.solve_count, created_at: r.created_at,
    }).collect();

    let solved = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(s.id) AS "solve_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           WHERE p.id IN (SELECT puzzle_id FROM solves WHERE user_id = $1)
           GROUP BY p.id, u.username
           ORDER BY p.created_at DESC"#,
        user.id
    )
    .fetch_all(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
    .into_iter().map(|r| PuzzleInfo {
        id: r.id.to_string(), name: r.name, creator: r.creator,
        board: r.board, queue: r.queue, requirements: r.requirements,
        num_pieces: r.num_pieces, solve_count: r.solve_count, created_at: r.created_at,
    }).collect();

    // in-flight / failed submissions, visible only to the profile's owner
    let pending = if is_owner {
        sqlx::query!(
            r#"SELECT j.id, j.status, j.failed_reason,
                      j.name AS job_name, j.target_puzzle_id,
                      tp.name AS "target_name?",
                      to_char(j.submitted, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "submitted_at!"
               FROM jobs j
               LEFT JOIN puzzles tp ON tp.id = j.target_puzzle_id
               WHERE j.user_id = $1 AND j.status IN ('pending', 'proving', 'failed')
               ORDER BY j.submitted DESC"#,
            user.id
        )
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("db error: {e}")))?
        .into_iter().map(|j| {
            let is_solve = j.target_puzzle_id.is_some();
            JobInfo {
                id: j.id.to_string(),
                status: j.status,
                kind: if is_solve { "solve".into() } else { "publish".into() },
                name: if is_solve {
                    j.target_name.unwrap_or_else(|| "puzzle".into())
                } else {
                    j.job_name.unwrap_or_else(|| "untitled".into())
                },
                failed_reason: j.failed_reason,
                submitted_at: j.submitted_at,
            }
        }).collect()
    } else {
        Vec::new()
    };

    Ok(Json(UserProfile {
        username: user.username,
        created_at: user.created_at,
        created,
        solved,
        pending,
    }))
}

type VerifierData = (VerifierOnlyCircuitData<PoseidonGoldilocksConfig,2>, CommonCircuitData<GoldilocksField,2>);


fn load_verifiers() -> Vec<VerifierData> {
    let gate_serializer = DefaultGateSerializer;
    let mut verifiers = Vec::new();
    for num_pieces in 1..=21 {
        let verifier_bytes = std::fs::read(format!("verifier_data/verifier_{}.bin", num_pieces)).unwrap();
        let common_bytes = std::fs::read(format!("verifier_data/common_{}.bin", num_pieces)).unwrap();
        let verifier_only = VerifierOnlyCircuitData::from_bytes(verifier_bytes).unwrap();
        let common = CommonCircuitData::from_bytes(common_bytes, &gate_serializer).unwrap();
        verifiers.push((verifier_only, common));
    }
    verifiers
}
