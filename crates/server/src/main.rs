use axum::{Router, routing::{get, post}, Json, extract::State, extract::Path, http::StatusCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
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
    new_job: Notify
}

#[tokio::main]
async fn main() {

    let db = PgPool::connect("postgresql://localhost/plonktris")
    .await.unwrap();

    println!("loading verifiers...");
    let verifiers = Arc::new(load_verifiers());
    println!("ready!");

    let state = Arc::new(AppState { db: db, verifiers: verifiers, new_job: Notify::new() });
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
        .layer(CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("listening on port 3000");
    axum::serve(listener, app).await.unwrap();
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
    if num_pieces < 1 || num_pieces > 25 {
        return Err((StatusCode::BAD_REQUEST, "num_pieces must be between 1 and 25".into()));
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
        None
    } else {

        //puzzle name moderation
        let n = body.name.unwrap_or_default().trim().to_string();
        let n = if n.is_empty() { "untitled".to_string() } else { n };
        if n.len() > 64 {
            return Err((StatusCode::BAD_REQUEST, "name must be at most 64 characters".into()));
        }
        if rustrict::CensorStr::is_inappropriate(n.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "pick a different puzzle name".into()));
        }
        Some(n)
    };

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
                // solve mode records a solve on the target puzzle;
                // publish mode creates a new puzzle
                let outcome = if let Some(target) = job.target_puzzle_id {
                    record_solve(worker_state, proof_bytes, &job.board, &job.queue,
                        &job.requirements, target, job.user_id).await
                } else {
                    let body = SubmitVerificationRequest {
                        proof: proof_bytes,
                        board: job.board,
                        queue: job.queue,
                        requirements: job.requirements,
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
}

#[derive(Serialize)]
struct SubmitVerificationResponse {
    success: bool,
    proof_id: String,
}

// verify proof bytes against the verifier for this queue length
fn verify_proof(state: &AppState, proof: &[u8], num_pieces: usize) -> Result<(), String> {
    if num_pieces < 1 || num_pieces > 25 {
        return Err(format!("num_pieces must be between 1 and 25"));
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
    .fetch_one(&state.db).await.map_err(|e| format!("db error: {e}"))?;

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
        sqlx::query!(
            "INSERT INTO solves (puzzle_id, user_id, proof)
             VALUES ($1, $2, CASE WHEN EXISTS
                 (SELECT 1 FROM solves WHERE puzzle_id = $1) THEN NULL::bytea ELSE $3 END)
             ON CONFLICT DO NOTHING",
            target,
            user_id,
            proof,
        )
        .execute(&state.db).await.map_err(|e| format!("db error: {e}"))?;
    }

    Ok(target)
}

async fn submit_proof_json(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SubmitVerificationRequest>,
) -> Result<Json<SubmitVerificationResponse>, (StatusCode, String)> {

    let id = submit_proof(state, body, None, "untitled".to_string()).await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

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


async fn register_account(
    State(state): State<Arc<AppState>>,
    Json(body): Json<AccountRequest>,
) -> Result<Json<AuthResponse>, (StatusCode, String)> {
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

async fn list_puzzles(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let rows = sqlx::query!(
        r#"SELECT p.id, p.name, u.username AS "creator?",
                  p.board, p.queue, p.requirements, p.num_pieces,
                  COUNT(s.id) AS "solve_count!",
                  to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "created_at!"
           FROM puzzles p
           LEFT JOIN users u ON u.id = p.creator_id
           LEFT JOIN solves s ON s.puzzle_id = p.id
           GROUP BY p.id, u.username
           ORDER BY p.created_at DESC"#
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

type VerifierData = (VerifierOnlyCircuitData<PoseidonGoldilocksConfig,2>, CommonCircuitData<GoldilocksField,2>);


fn load_verifiers() -> Vec<VerifierData> {
    let gate_serializer = DefaultGateSerializer;
    let mut verifiers = Vec::new();
    for num_pieces in 1..=25 {
        let verifier_bytes = std::fs::read(format!("verifier_data/verifier_{}.bin", num_pieces)).unwrap();
        let common_bytes = std::fs::read(format!("verifier_data/common_{}.bin", num_pieces)).unwrap();
        let verifier_only = VerifierOnlyCircuitData::from_bytes(verifier_bytes).unwrap();
        let common = CommonCircuitData::from_bytes(common_bytes, &gate_serializer).unwrap();
        verifiers.push((verifier_only, common));
    }
    verifiers
}
