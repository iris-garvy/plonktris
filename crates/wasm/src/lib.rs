use plonky2::field::types::{Field};
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::circuit_builder::{CircuitBuilder};
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::plonk::circuit_data::{CircuitConfig};
use wasm_bindgen::prelude::*;
use circuit::*;


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