use axum::{Router, routing::{get, post}, Json, extract::State, extract::Path};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use sqlx::PgPool;
use plonky2::{field::goldilocks_field::GoldilocksField, util::serialization::DefaultGateSerializer};
use plonky2::plonk::{config::PoseidonGoldilocksConfig, proof::ProofWithPublicInputs};
use plonky2::plonk::circuit_data::{CommonCircuitData, VerifierOnlyCircuitData, VerifierCircuitData};
use tokio::sync::Notify;
use circuit::generate_proof;
use tower_http::cors::{CorsLayer, Any};




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
} 

async fn request_proof(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SubmitProofRequest>
) -> Result<Json<SubmitVerificationResponse>, String> {
    let num_pieces = body.queue.len();
    let mut req_counter = 0;
    if num_pieces < 1 || num_pieces > 25 {
        return Err(format!("num_pieces must be between 1 and 25"));
    }
    for req in 0..7 {
        req_counter += body.requirements[req];
    }
    if req_counter == 0 {
        return Err(format!("must have requirements"));
    }

    let id = sqlx::query_scalar!(
        "INSERT INTO jobs (board, queue, requirements, actions)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
        body.board,
        body.queue,
        body.requirements,
        body.actions
    )
    .fetch_one(&state.db)
    .await
    .unwrap();

    state.new_job.notify_one();

    Ok(Json(SubmitVerificationResponse {
        success: true,
        proof_id: id.to_string(),
    }))
}

async fn process_next_job(worker_state: &Arc<AppState>) -> Result<bool, String> {
    let job = sqlx::query!(
        "SELECT id, board, queue, requirements, actions 
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
                let body = SubmitVerificationRequest { 
                    proof: proof_bytes, 
                    board: job.board, 
                    queue: job.queue, 
                    requirements: job.requirements 
                };
                match submit_proof(worker_state.clone(), body).await {
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
) -> Result<Json<JobStatusResponse>, String> {
    let job = sqlx::query!(
        "SELECT status, puzzle_id, failed_reason FROM jobs WHERE id = $1",
        job_id
    )
    .fetch_optional(&state.db)
    .await
    .map_err(|e| format!("db error: {e}"))?
    .ok_or("job not found".to_string())?;

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

async fn submit_proof(
    state: Arc<AppState>,
    body: SubmitVerificationRequest,
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

    if num_pieces < 1 || num_pieces > 25 {
        return Err(format!("num_pieces must be between 1 and 25"));
    }

    let mut req_counter = 0;
    for req in 0..7 {
        req_counter += body.requirements[req];
    }
    if req_counter == 0 {
        return Err(format!("must have requirements"))
    }

    let (verifier_only, common) = &state.verifiers[num_pieces - 1];
    let verifier = VerifierCircuitData {
        verifier_only: verifier_only.clone(),
        common: common.clone(),
    };

    let proof = ProofWithPublicInputs::<GoldilocksField, PoseidonGoldilocksConfig, 2>::from_bytes(
        body.proof.clone(),
        &common
    ).map_err(|e| format!("invalid proof bytes: {e}"))?;

    verifier.verify(proof)
    .map_err(|e| format!("proof verification failed: {e}"))?;

    let id = sqlx::query_scalar!(
        "INSERT INTO puzzles (proof, board, queue, requirements, num_pieces, tss, tsd, tst, attack, pc, tetris, max_combo, no_hold)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        no_hold
    )
    .fetch_one(&state.db).await.map_err(|e| format!("db error: {e}"))?;
    
    Ok(id)
}

async fn submit_proof_json(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SubmitVerificationRequest>,
) -> Result<Json<SubmitVerificationResponse>, String> {

    let id = submit_proof(state, body).await?;
    
    Ok(Json(SubmitVerificationResponse {
        success: true,
        proof_id: id.to_string(),
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
