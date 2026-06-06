use axum::{Router, routing::{get, post}, Json, extract::State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use sqlx::PgPool;
use plonky2::{field::goldilocks_field::GoldilocksField, plonk::circuit_data::{CommonCircuitData, VerifierOnlyCircuitData}};
use plonky2::plonk::config::PoseidonGoldilocksConfig;
use plonky2::util::serialization::DefaultGateSerializer;
use plonky2::plonk::proof::ProofWithPublicInputs;
use plonky2::plonk::circuit_data::VerifierCircuitData;

#[derive(Deserialize)]
struct SubmitProofRequest {
    proof: Vec<u8>,
    board: Vec<u8>,
    queue: Vec<u8>,
    requirements: Vec<u8>,
}

#[derive(Serialize)]
struct SubmitProofResponse {
    success: bool,
    proof_id: String,
}

async fn submit_proof(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SubmitProofRequest>,
) -> Result<Json<SubmitProofResponse>, String> {
    let num_pieces = body.queue.len();
    let tss = body.requirements[0] as i32;
    let tsd = body.requirements[1] as i32;
    let tst = body.requirements[2] as i32;
    let tetris = body.requirements[3] as i32;
    let pc = body.requirements[4] as i32;
    let attack = body.requirements[5] as i32;

    if num_pieces < 1 || num_pieces > 25 {
        return Err(format!("num_pieces must be between 1 and 25"));
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
        "INSERT INTO puzzles (proof, board, queue, requirements, num_pieces, tss, tsd, tst, attack, pc, tetris)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    )
    .fetch_one(&state.db)
    .await
    .unwrap();
    
    Ok(Json(SubmitProofResponse {
        success: true,
        proof_id: id.to_string(),
    }))
}

type VerifierData = (VerifierOnlyCircuitData<PoseidonGoldilocksConfig,2>, CommonCircuitData<GoldilocksField,2>);

#[derive(Clone)]
struct AppState {
    db: PgPool,
    verifiers: Arc<Vec<VerifierData>>
}

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

#[tokio::main]
async fn main() {
    let db = PgPool::connect("postgresql://localhost/plonktris")
    .await.unwrap();

    println!("loading verifiers...");
    let verifiers = Arc::new(load_verifiers());
    println!("ready!");

    let state = Arc::new(AppState { db: db, verifiers: verifiers });

    let app = Router::new()
        .route("/health", get(|| async { "plonktris online" }))
        .route("/submit", post(submit_proof))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("listening on port 3000");
    axum::serve(listener, app).await.unwrap();
}