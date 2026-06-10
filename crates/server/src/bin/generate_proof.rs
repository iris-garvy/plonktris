use circuit::*;
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::field::types::Field;
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::circuit_builder::CircuitBuilder;
use plonky2::plonk::circuit_data::CircuitConfig;
use plonky2::plonk::config::PoseidonGoldilocksConfig;
use rayon::ThreadPoolBuilder;
use num_cpus::get;

fn main() {
    let config = CircuitConfig::standard_recursion_config();
    let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);

    let num_pieces = 5;
    let bits_t = deserialize_board(&mut builder);
    let board_t = bits_to_board(&mut builder, bits_t).unwrap();
    let queue_t = deserialize_queue(&mut builder, num_pieces + 1);
    let req_t = deserialize_requirements(&mut builder);
    let actions_t = deserialize_actions(&mut builder, num_pieces);

    let mut pw = PartialWitness::new();

    // empty board
    let board = vec![0u8; 210];
    //board[0] = 1;
    for (i, &byte) in board.iter().enumerate() {
        pw.set_target(bits_t[i], GoldilocksField::from_canonical_u8(byte)).unwrap();
    }

    // queue: 3 T pieces (piece index 2)
    let queue = vec![0, 0, 0, 0, 1];
    for (i, &piece) in queue.iter().enumerate() {
        pw.set_target(queue_t[i], GoldilocksField::from_canonical_u8(piece)).unwrap();
    }
    pw.set_target(queue_t[num_pieces],GoldilocksField::from_canonical_usize(7)).unwrap();

    // requirements: all zeros (just prove anything)
    let requirements = vec![0, 0, 0, 0, 1, 0 ,0 ,0];
    for (i, &req) in requirements.iter().enumerate() {
        pw.set_target(req_t[i], GoldilocksField::from_canonical_u8(req)).unwrap();
    }

    // sd
    let mut secret_moves = vec![6u8; num_pieces * 32];
    for i in 0..4 {
        secret_moves[i] = 0;
        secret_moves[32+i] = 0;
        secret_moves[64+i] = 1;
        secret_moves[96+i] = 1;
    }
    for piece in 0..num_pieces {
        for act in 0..32 {
            let index = piece * 32 + act;
            pw.set_target(actions_t[piece][act], GoldilocksField::from_canonical_u8(secret_moves[index])).unwrap();
        }
    }

    let ledger = simulate(&mut builder, board_t, &queue_t, &actions_t);
    verify_requirements(&mut builder, req_t, ledger);

    let data = builder.build::<PoseidonGoldilocksConfig>();
    eprintln!("proving...");
    eprintln!("circuit digest: {:?}", data.verifier_only.circuit_digest);
    let proof = data.prove(pw).unwrap();
    let proof_bytes = proof.to_bytes();
    
    println!("{}", serde_json::json!({
        "proof": proof_bytes,
        "board": board,
        "queue": queue,
        "requirements": requirements,
    }));
}