use plonky2::field::types::{Field};
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::circuit_builder::{CircuitBuilder};
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::plonk::circuit_data::{CircuitConfig};
use wasm_bindgen::prelude::*;
use circuit::*;
use circuit::reclib;
use std::cell::RefCell;
use std::rc::Rc;
use std::collections::HashMap;

// Recursive prover config — must match the server (crates/server/src/main.rs) so the
// server can verify browser-made proofs.
const REC_CHUNK: usize = 4;
const REC_AGG_PAD: usize = 1 << 13;

thread_local! {
    // built circuits cached per padded length (the worker keeps wasm loaded across proofs)
    static REC_CACHE: RefCell<HashMap<usize, Rc<(reclib::StepCircuit, reclib::AggCircuit)>>> =
        RefCell::new(HashMap::new());
}

fn rec_circuits(padded_len: usize) -> Rc<(reclib::StepCircuit, reclib::AggCircuit)> {
    REC_CACHE.with(|c| {
        c.borrow_mut().entry(padded_len).or_insert_with(|| {
            let step = reclib::StepCircuit::build(REC_CHUNK, padded_len);
            // padded build (no catch_unwind — that's a no-op under wasm panic=abort)
            let agg = reclib::build_aggregator_padded(&step, padded_len, REC_AGG_PAD);
            Rc::new((step, agg))
        }).clone()
    })
}

/// Recursive (chunked) in-browser prover for long puzzles. Same inputs as
/// `prove_requirements`; requirements are checked server-side at verify time.
#[wasm_bindgen]
pub fn prove_requirements_recursive(
    board: &[u8],
    queue: &[u8],
    _requirements: &[u8],
    secret_moves: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let num_pieces = queue.len();
    let all_actions: Vec<Vec<u8>> = (0..num_pieces)
        .map(|p| secret_moves[p * 32..(p + 1) * 32].to_vec())
        .collect();
    let (pq, pa) = reclib::pad_puzzle(queue, &all_actions, REC_CHUNK);
    let circuits = rec_circuits(pq.len());
    let proof = reclib::prove_solution(&circuits.0, &circuits.1, REC_CHUNK, board, &pq, &pa)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(proof.to_bytes())
}


#[wasm_bindgen]
pub fn prove_requirements(
    board: &[u8],
    queue: &[u8],
    requirements: &[u8],
    secret_moves: &[u8]
) -> Result<Vec<u8>, JsValue> {
    let zero = GoldilocksField::ZERO;
    let one = GoldilocksField::ONE;

    let config = CircuitConfig::standard_recursion_config();
    let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);

    let num_pieces = queue.len();
    let bits_t = deserialize_board(&mut builder);
    let board_t =bits_to_board(&mut builder, bits_t)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let queue_t = deserialize_queue(&mut builder, num_pieces + 1);
    let requirements_t = deserialize_requirements(&mut builder);
    let actions_t = deserialize_actions(&mut builder, num_pieces);


    let mut pw = PartialWitness::new();
    for (i, &byte) in board.iter().enumerate() {
        if byte == 1 {
            pw.set_target(bits_t[i], one).map_err(|e| JsValue::from_str(&e.to_string()))?;
        } else {
            pw.set_target(bits_t[i], zero).map_err(|e| JsValue::from_str(&e.to_string()))?;
        }
    }

    for (i, &piece) in queue.iter().enumerate() {
        pw.set_target(queue_t[i], GoldilocksField::from_canonical_u8(piece))
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    }
    pw.set_target(queue_t[num_pieces], GoldilocksField::from_canonical_usize(7))
    .map_err(|e| JsValue::from_str(&e.to_string()))?;

    for piece in 0..num_pieces {
        for act in 0..32 {
            let index = piece * 32 + act;
            pw.set_target(actions_t[piece][act], GoldilocksField::from_canonical_u8(secret_moves[index]))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        }
    }
    for (i, &req) in requirements.iter().enumerate() {
        pw.set_target(requirements_t[i], GoldilocksField::from_canonical_u8(req))
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    }

    let ledger = simulate(&mut builder, board_t, &queue_t, &actions_t);
    verify_requirements(&mut builder, requirements_t, ledger);

    let data = builder.build::<plonky2::plonk::config::PoseidonGoldilocksConfig>();
    let proof = data.prove(pw)
    .map_err(|e| JsValue::from_str(&format!("prove failed: {e:#?}")))?;

    Ok(proof.to_bytes())
}



#[cfg(test)]
mod tests {
    use plonky2::field::types::{Field};
    use plonky2::iop::witness::{PartialWitness, WitnessWrite};
    use plonky2::plonk::circuit_builder::{CircuitBuilder};
    use plonky2::field::goldilocks_field::GoldilocksField;
    use plonky2::plonk::circuit_data::CircuitConfig;
    use plonky2::plonk::config::PoseidonGoldilocksConfig;
    use std::time::Instant;
    use circuit::*;

    #[test]
    fn test_prove_requirements() {
        let t0 = std::time::Instant::now();
        let config = CircuitConfig::standard_recursion_config();
        let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);

        let num_pieces = 3;
        let bits_t = deserialize_board(&mut builder);
        let board_t = bits_to_board(&mut builder, bits_t).unwrap();
        let queue_t = deserialize_queue(&mut builder, num_pieces + 1);
        let req_t = deserialize_requirements(&mut builder);
        let actions_t = deserialize_actions(&mut builder, num_pieces);

        let ledger = simulate(&mut builder, board_t, &queue_t, &actions_t);
        verify_requirements(&mut builder, req_t, ledger);

        let mut pw = PartialWitness::new();
        eprintln!("build took {:?}", t0.elapsed());
        // empty board
        let board = vec![0u8; 210];
        for (i, &byte) in board.iter().enumerate() {
            pw.set_target(bits_t[i], GoldilocksField::from_canonical_u8(byte)).unwrap();
        }

        // queue: 3 T pieces (piece index 2)
        let queue = vec![2u8; num_pieces];
        for (i, &piece) in queue.iter().enumerate() {
            pw.set_target(queue_t[i], GoldilocksField::from_canonical_u8(piece)).unwrap();
        }
        pw.set_target(queue_t[num_pieces], GoldilocksField::from_canonical_u8(7)).unwrap();

        // requirements: all zeros (just prove anything)
        let requirements = vec![0u8; 8];
        for (i, &req) in requirements.iter().enumerate() {
            pw.set_target(req_t[i], GoldilocksField::from_canonical_u8(req)).unwrap();
        }

        // sd
        let secret_moves = vec![6u8; num_pieces * 32];
        for piece in 0..num_pieces {
            for act in 0..32 {
                let index = piece * 32 + act;
                pw.set_target(actions_t[piece][act], GoldilocksField::from_canonical_u8(secret_moves[index])).unwrap();
            }
        }


        eprintln!("num gates: {}", builder.num_gates());
        let data = builder.build::<PoseidonGoldilocksConfig>();


        eprintln!("proving...");
        let t1 = std::time::Instant::now();
        let proof = data.prove(pw).unwrap();
        eprintln!("proof took {:?}", t1.elapsed());
    }
    
}