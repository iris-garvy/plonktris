use axum::{Router, routing::{get, post}, Json, extract::State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone)]
struct AppState {
    // db pool will go here later
}

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
) -> Json<SubmitProofResponse> {
    // verification and storage will go here
    Json(SubmitProofResponse {
        success: true,
        proof_id: "test-id".to_string(),
    })
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState {});

    let app = Router::new()
        .route("/health", get(|| async { "plonktris online" }))
        .route("/submit", post(submit_proof))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("listening on port 3000");
    axum::serve(listener, app).await.unwrap();
}