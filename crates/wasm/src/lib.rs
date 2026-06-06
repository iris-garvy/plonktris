use plonky2::field::types::{Field};
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::circuit_builder::{CircuitBuilder};
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::plonk::circuit_data::CircuitConfig;
use wasm_bindgen::prelude::*;
use circuit::*;

#[wasm_bindgen]
pub fn prove_requirements(
    board: &[u8],
    queue: &[u8],
    requirements: &[u8],
    secret_moves: &[u8]
) -> Result<Vec<u8>, JsValue> {
    let config = CircuitConfig::standard_recursion_config();
    let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);

    let num_pieces = queue.len();
    let bits_t = deserialize_board(&mut builder);
    let board_t =bits_to_board(&mut builder, bits_t)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let queue_t = deserialize_queue(&mut builder, num_pieces);
    let actions_t = deserialize_actions(&mut builder, num_pieces);
    let zero = GoldilocksField::ZERO;
    let one = GoldilocksField::ONE;

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
    for piece in 0..num_pieces {
        for act in 0..32 {
            let index = piece * 32 + act;
            pw.set_target(actions_t[piece][act], GoldilocksField::from_canonical_u8(secret_moves[index]))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        }
    }


    let ledger = simulate(&mut builder, board_t, queue_t, actions_t);
    verify_requirements(&mut builder, requirements, ledger);

    let data = builder.build::<plonky2::plonk::config::PoseidonGoldilocksConfig>();
    let proof = data.prove(pw)
    .map_err(|e| JsValue::from_str(&format!("prove failed: {e:#?}")))?;

    Ok(proof.to_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prove_requirements() {
        // a board you know is valid
        let board = vec![0u8; 210];
        
        // a simple queue, like just T pieces
        let queue = vec![0u8; 3];  // whatever your piece encoding is
        
        // requirements — like 1 tspin minimum
        let requirements = vec![0u8;6];
        
        // a known valid move sequence that achieves those requirements
        let mut secret_moves = vec![5u8; 3 * 32];  // all no-ops to start
        // set some real moves for piece 0
        secret_moves[0] = 2;  // rotate cw
        secret_moves[1] = 2;  // rotate cw
        // etc
        
        let result = prove_requirements(&board, &queue, &requirements, &secret_moves);
        assert!(result.is_ok());
    }
}


#[test]
fn check_verifier_size() {
    let config = CircuitConfig::standard_recursion_config();
    let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);
    
    let num_pieces = 5;
    let bits_t = deserialize_board(&mut builder);
    let board_t = bits_to_board(&mut builder, bits_t).unwrap();
    let queue_t = deserialize_queue(&mut builder, num_pieces);
    let actions_t = deserialize_actions(&mut builder, num_pieces);
    let ledger = simulate(&mut builder, board_t, queue_t, actions_t);
    
    let data = builder.build::<plonky2::plonk::config::PoseidonGoldilocksConfig>();
    let verifier_bytes = data.verifier_only.to_bytes().unwrap();
    let common_bytes = data.common.to_bytes().unwrap();
    
    println!("verifier_only: {} bytes", verifier_bytes.len());
    println!("common_data: {} bytes", common_bytes.len());
}