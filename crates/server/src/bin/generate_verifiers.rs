use circuit::*;
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::plonk::circuit_builder::CircuitBuilder;
use plonky2::plonk::circuit_data::CircuitConfig;
use plonky2::plonk::config::PoseidonGoldilocksConfig;
use plonky2::util::serialization::DefaultGateSerializer;
use std::fs;

fn main() {
    fs::create_dir_all("verifier_data").unwrap();

    for num_pieces in 1..=25 {
        println!("building circuit for {} pieces...", num_pieces);

        let config = CircuitConfig::standard_recursion_config();
        let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);

        let bits_t = deserialize_board(&mut builder);
        let board_t = bits_to_board(&mut builder, bits_t).unwrap();
        let queue_t = deserialize_queue(&mut builder, num_pieces + 1);
        let requirements_t = deserialize_requirements(&mut builder);
        let actions_t = deserialize_actions(&mut builder, num_pieces);
        let ledger = simulate(&mut builder, board_t, &queue_t, &actions_t);
        verify_requirements(&mut builder, requirements_t, ledger);

        let data = builder.build::<PoseidonGoldilocksConfig>();

        let gate_serializer = DefaultGateSerializer;

        fs::write(
            format!("verifier_data/verifier_{}.bin", num_pieces),
            data.verifier_only.to_bytes().unwrap()
        ).unwrap();
        fs::write(
            format!("verifier_data/common_{}.bin", num_pieces),
            data.common.to_bytes(&gate_serializer).unwrap()
        ).unwrap();

        println!("done {} pieces", num_pieces);
    }

    println!("all done!");
}