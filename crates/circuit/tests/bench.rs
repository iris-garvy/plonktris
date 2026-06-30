//   cargo test --release -p circuit --test bench -- --ignored --nocapture
use circuit::*;
use std::time::Instant;

#[test]
#[ignore]
fn bench_monolithic() {
    eprintln!("\n== monolithic ==");
    for n in [4usize, 6, 8] {
        let board = vec![0u8; 210];
        let queue = vec![2u8; n];          // n T-pieces
        let req = vec![0u8; 8];
        let moves = vec![6u8; n * 32];     // hard-drop each

        let t = Instant::now();
        let c = MonoCircuit::build(n);
        let build_ms = t.elapsed().as_millis();
        let degree = c.data.common.degree_bits();

        let t = Instant::now();
        let proof = c.prove(&board, &queue, &req, &moves).expect("prove");
        let prove_ms = t.elapsed().as_millis();

        let bytes = proof.to_bytes();

        let t = Instant::now();
        c.verify_bytes(&bytes, &board, &queue, &req).expect("verify");
        let verify_ms = t.elapsed().as_millis();

        eprintln!(
            "n={n}: degree_bits={degree} (~{} gates) | build {build_ms}ms | prove {prove_ms}ms | verify {verify_ms}ms | proof {} bytes",
            1u64 << degree, bytes.len()
        );
    }
}

#[test]
#[ignore]
fn bench_recursive() {
    eprintln!("\n== recursive (chunk 4) ==");
    let board = vec![0u8; 210];
    let req = vec![0u8; 8];
    let real_queue: Vec<u8> = (0..11).map(|i| (i % 7) as u8).collect();
    let mut all_actions: Vec<Vec<u8>> = Vec::new();
    for k in 0..11u8 {
        let mut a = Vec::with_capacity(32);
        for x in 0..32u8 { a.push(if x < (k % 8) { 1u8 } else { 6u8 }); }
        all_actions.push(a);
    }
    let (pq, pa) = reclib::pad_puzzle(&real_queue, &all_actions, 4);

    let t = Instant::now();
    let step = reclib::StepCircuit::build(4, pq.len());
    let agg = reclib::build_aggregator_padded(&step, pq.len(), 1 << 13);
    let build_ms = t.elapsed().as_millis();

    let t = Instant::now();
    let proof = reclib::prove_solution(&step, &agg, 4, &board, &pq, &pa).expect("prove");
    let prove_ms = t.elapsed().as_millis();

    let bytes = proof.to_bytes();

    let t = Instant::now();
    reclib::verify_solution_bytes(&agg, &bytes, &board, &pq, &req, pq.len()).expect("verify");
    let verify_ms = t.elapsed().as_millis();

    eprintln!(
        "11 pieces (padded to {}): build {build_ms}ms | prove {prove_ms}ms | verify {verify_ms}ms | proof {} bytes",
        pq.len(), bytes.len()
    );
}
