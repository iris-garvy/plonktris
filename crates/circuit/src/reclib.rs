use plonky2::field::{types::{Field, PrimeField64}, extension::Extendable};
use plonky2::iop::target::{BoolTarget, Target};
use plonky2::plonk::circuit_builder::{CircuitBuilder};
use plonky2::field::goldilocks_field::{GoldilocksField};
use plonky2::plonk::circuit_data::{CircuitConfig, CircuitData, VerifierCircuitTarget};
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::config::{GenericConfig, PoseidonGoldilocksConfig, AlgebraicHasher};
use plonky2::recursion::{dummy_circuit::cyclic_base_proof, cyclic_recursion::check_cyclic_proof_verifier_data};
use plonky2::plonk::proof::{ProofWithPublicInputs, ProofWithPublicInputsTarget};
use plonky2::hash::hash_types::RichField;
use plonky2::plonk::circuit_data::CommonCircuitData;
use plonky2::gates::noop::NoopGate;
use hashbrown::HashMap; 


type F = GoldilocksField;
type C = PoseidonGoldilocksConfig;
const D: usize = 2;

fn spawn(
    board: BoardTargets,
    current_piece: Target, 
    next_piece: Target,
    held_piece: Target,
    builder: &mut CircuitBuilder<F, D>, 
    shape_table: usize
) -> PieceStateTargets {
    let zero = builder.zero();
    let one = builder.one();
    let null_target = builder.constant(F::from_canonical_usize(7));

    let hold_null = builder.is_equal(held_piece, null_target);
    let current_null = builder.is_equal(current_piece, null_target);
    let both_null = builder.and(hold_null, current_null);

    let mut letter = builder.select(hold_null, current_piece, next_piece);
    letter = builder.select(current_null, held_piece, letter);
    letter = builder.select(both_null, one, letter);

    let is_one = builder.is_equal(letter, one);
    let fourteen = builder.constant(F::from_canonical_usize(14));
    let thirteen = builder.constant(F::from_canonical_usize(13));

    let piece_shape = get_shape(builder, letter, zero, shape_table);
    let piece_state = PieceStateTargets{ 
        piece: letter, 
        rotation: zero, 
        shape: piece_shape,
        row: zero,
        col: builder.select(is_one,fourteen, thirteen),
    };

    let no_collisions = board.no_collision(builder, piece_shape, piece_state.row, piece_state.col).target;
    // current_null (current piece == 7) is an empty/padding slot — bypass the collision
    // check; its result is discarded as a no-op in induction_step. (Real play never has
    // current == 7, so this doesn't affect normal pieces.)
    let game_okay = builder.select(current_null, one, no_collisions);
    builder.assert_one(game_okay);

    piece_state
}


#[derive(Debug, Clone, Copy)]
struct Tables {
    shapes: usize,
    kicks: usize,
    combo: usize,
    geq: usize,
}

impl Tables {
    fn default(builder: &mut CircuitBuilder<F, D>) -> Self {
        Self {
            shapes: construct_shapes(builder),
            kicks: construct_kicks(builder),
            combo: construct_combo(builder),
            geq: construct_geq(builder),
        }
    }
}

fn construct_geq(builder: &mut CircuitBuilder<F, D>) -> usize {
    let mut input = Vec::new();
    let mut output = Vec::new();
    for a in 0..=25 {
        for b in 0..=25 {
            let index = 26 * a + b as u16;
            input.push(index);
            if a >= b { output.push(1 as u16); } else {output.push(0 as u16);}
        }
    }
    builder.add_lookup_table_from_table(&input, &output)
}

fn construct_combo(builder: &mut CircuitBuilder<F, D>) -> usize {
    let mut input  = Vec::new();
    let mut output = Vec::new();
    for index in 0..25 {
        input.push(index as u16);
        output.push(COMBO_TABLE[index] as u16);
    }
    builder.add_lookup_table_from_table(&input, &output)
}

fn construct_kicks(builder: &mut CircuitBuilder<F, D>) -> usize {
    let mut input = Vec::new();
    let mut output = Vec::new();
    for piece in 0..2 {
        for transition in 0..8 {
            for kick in 0..5 {
                for axis in 0..2 {
                    let index = piece * 80 + transition * 10 + kick * 2 + axis;
                    input.push(index as u16);
                    let offset_value = (KICK_TABLES[piece][transition][kick][axis] + 5) as u16;
                    output.push(offset_value);
                }
            }
        }
    }
    builder.add_lookup_table_from_table(&input, &output)
}

fn construct_shapes(builder: &mut CircuitBuilder<F, D>) -> usize {
    let mut input = Vec::new();
    let mut output = Vec::new();
    for p in 0..8{
        for r in 0..4 {
            for b in 0..4 {
                for a in 0..2 {
                    let index = p * 32 + r * 8 + b * 2 + a;
                    let value = PIECE_SHAPE[p][r][b][a];
                    input.push(index as u16);
                    output.push(value as u16);
                }
            }
        }
    }
    builder.add_lookup_table_from_table(&input, &output)
}

fn get_shape(
    builder: &mut CircuitBuilder<F, D>, 
    piece: Target, 
    rotation: Target, 
    table: usize
) -> [[Target;2];4] {
    let zero = builder.zero();
    let eight = builder.constant(F::from_canonical_usize(8));
    let thirty_two = builder.constant(F::from_canonical_usize(32));  
    let mut coords = [[zero;2];4];

    let piece_index = builder.mul(piece, thirty_two);
    let pr_index = builder.mul_add(rotation, eight, piece_index);

    for block in 0..4 {
        for axis in 0..2 {
            let ba_index = block * 2 + axis;
            let ba_t = builder.constant(F::from_canonical_usize(ba_index));
            let index_t = builder.add(ba_t, pr_index);

            coords[block][axis] = builder.add_lookup_from_index(index_t, table);
        }
    }
    coords
}

fn col_to_mask(
    builder: &mut CircuitBuilder<F, D>,
    col: Target,
) -> Target {
    let mut mask = builder.zero();
    for i in 10..20 {
        let shifted_index = i - 10;
        let i_target = builder.constant(F::from_canonical_u32(i));
        let is_col = builder.is_equal(col, i_target);
        let bit_value = builder.constant(F::from_canonical_u32(1 << shifted_index));
        let term = builder.mul(is_col.target, bit_value);
        mask = builder.add(mask, term);
    }
    mask
}


fn select_piece_state(
    builder: &mut CircuitBuilder<F, D>,
    cond: BoolTarget,
    a: PieceStateTargets,
    b: PieceStateTargets,
) -> PieceStateTargets {
    let mut shape = [[builder.zero();2];4];
    for block in 0..4 {
        for coord in 0..2 {
            shape[block][coord] = builder.select(cond, a.shape[block][coord], b.shape[block][coord]);
        }
    }
    PieceStateTargets {
        piece: builder.select(cond, a.piece, b.piece),
        rotation: builder.select(cond, a.rotation, b.rotation),
        shape: shape,
        row: builder.select(cond, a.row, b.row),
        col: builder.select(cond, a.col, b.col),
    }
}

fn pack_board(bits: &[u8]) -> [F; 21] { 
    let mut rows = [F::ZERO; 21];
    for r in 0..21 {
        let mut v = 0u64;
        for c in 0..10 {
            v += (bits[r * 10 + c] as u64) << c; 
        }
        rows[r] = F::from_canonical_u64(v);
    }
    rows
}


fn common_data_for_recursion<F, C, const D: usize>(pad_to: usize) -> CommonCircuitData<F, D>
where F: RichField + Extendable<D>, C: GenericConfig<D, F = F>, C::Hasher: AlgebraicHasher<F> {
    let config = CircuitConfig::standard_recursion_config();
    let builder = CircuitBuilder::<F, D>::new(config);
    let data = builder.build::<C>();
    let mut builder = CircuitBuilder::<F, D>::new(CircuitConfig::standard_recursion_config());
    let proof = builder.add_virtual_proof_with_pis(&data.common);
    let vd = builder.add_virtual_verifier_data(data.common.config.fri_config.cap_height);
    builder.verify_proof::<C>(&proof, &vd, &data.common);
    let data = builder.build::<C>();
    let mut builder = CircuitBuilder::<F, D>::new(CircuitConfig::standard_recursion_config());
    let proof = builder.add_virtual_proof_with_pis(&data.common);
    let vd = builder.add_virtual_verifier_data(data.common.config.fri_config.cap_height);
    builder.verify_proof::<C>(&proof, &vd, &data.common);
    // pad_to controls this skeleton's degree, which must equal the aggregator's.
    // build_aggregator auto-tunes pad_to, so callers don't hardcode it.
    while builder.num_gates() < pad_to { builder.add_gate(NoopGate, vec![]); }
    builder.build::<C>().common
}

pub fn verify_solution(
    agg: &AggCircuit,
    proof: ProofWithPublicInputs<F, C, D>,
    board: &[u8], queue: &[u8], requirements: &[u8], num_pieces: usize
) -> Result<(), String> {
    agg.data.verify(proof.clone()).map_err(|e| e.to_string())?;
    check_cyclic_proof_verifier_data(&proof, &agg.data.verifier_only, &agg.common)
    .map_err(|e| e.to_string())?;

    let pi = &proof.public_inputs;
    let want = pack_board(board);
    for r in 0..21 {
        if pi[r] != want[r] {
            return Err("init board doesn't match puzzle".into());
        }
    }
    for r in 0..7 {
        if pi[42+r].to_canonical_u64() < requirements[r] as u64 {
            return Err("requirements not met".into());
        }
    }
    for p in 0..num_pieces {
        if pi[p + 54] != GoldilocksField::from_canonical_u8(queue[p]) {
            return Err("queue doesn't match puzzle".into());
        }
    }
    if pi[53] != GoldilocksField::from_canonical_usize(num_pieces) {
        return Err("queue not played out".into());
    }

    Ok(())
}

/// Byte-based verify for out-of-crate callers (the server): deserialize the aggregate
/// proof against the aggregator's common data, then run the full verify_solution.
pub fn verify_solution_bytes(
    agg: &AggCircuit,
    proof_bytes: &[u8],
    board: &[u8], queue: &[u8], requirements: &[u8], num_pieces: usize
) -> Result<(), String> {
    let proof = ProofWithPublicInputs::<F, C, D>::from_bytes(proof_bytes.to_vec(), &agg.data.common)
        .map_err(|e| format!("invalid recursive proof bytes: {e}"))?;
    verify_solution(agg, proof, board, queue, requirements, num_pieces)
}

fn base_state_values(init_board: &[u8], queue: &[u8], num_pieces: usize) -> Vec<F> {
    let rows = pack_board(init_board);                  // [F; 21]
    let mut v = Vec::with_capacity(55 + num_pieces);
    v.extend_from_slice(&rows);                         // initial_board [0..21]
    v.extend_from_slice(&rows);                         // board == initial board at start [21..42]
    v.extend(core::iter::repeat(F::ZERO).take(10));     // ledger = 0 [42..52]
    v.push(F::from_canonical_u64(7));                   // held = empty-hold sentinel [52]
    v.push(F::ZERO);                                    // queue_index = 0 [53]
    for &p in queue { v.push(F::from_canonical_u8(p)); }// queue ids [54..54+num_pieces]
    v.push(F::from_canonical_u64(7));                   // queue lookahead sentinel
    v
}

fn set_state(pw: &mut PartialWitness<F>, s: &StepState, v: &[F]) {
    for i in 0..21 { pw.set_target(s.initial_board.cells[i], v[i]).unwrap(); }
    for i in 0..21 { pw.set_target(s.board.cells[i], v[21 + i]).unwrap(); }
    for i in 0..10 { pw.set_target(s.ledger.ledger[i], v[42 + i]).unwrap(); }
    pw.set_target(s.held_piece, v[52]).unwrap();
    pw.set_target(s.queue_index, v[53]).unwrap();
    for i in 0..(v.len() - 54) { pw.set_target(s.queue[i], v[54 + i]).unwrap(); }
}

fn set_actions(pw: &mut PartialWitness<F>, actions: &[Target], acts: &[u8]) {
    for (t, &a) in actions.iter().zip(acts) {
        pw.set_target(*t, F::from_canonical_u8(a)).unwrap();
    }
}

fn set_base(pw: &mut PartialWitness<F>, base: &StepState, init_board: &[u8], queue: &[u8]) {
    let rows = pack_board(init_board);
    for i in 0..21 { pw.set_target(base.board.cells[i], rows[i]).unwrap(); }
    for (t, &p) in base.queue.iter().zip(queue) {
        pw.set_target(*t, F::from_canonical_u8(p)).unwrap();
    }
}

/// Pad a puzzle's queue + actions up to a multiple of `chunk` with sentinel (7) no-op
/// pieces and NOOP-filled action slots. The recursive circuits are built for the padded
/// length; the sentinel pieces are skipped at proving time. Both prover and verifier must
/// pad identically (same chunk) so the bound queue matches.
pub fn pad_puzzle(queue: &[u8], all_actions: &[Vec<u8>], chunk: usize) -> (Vec<u8>, Vec<Vec<u8>>) {
    let padded = ((queue.len() + chunk - 1) / chunk) * chunk;   // round up to a multiple of chunk
    let mut q = queue.to_vec();
    q.resize(padded, 7u8);                                       // sentinel padding pieces
    let mut a = all_actions.to_vec();
    a.resize(padded, vec![6u8; 32]);                            // NOOP action slots
    (q, a)
}

pub fn prove_solution(step: &StepCircuit, agg: &AggCircuit, chunk: usize,
                  init_board: &[u8], queue: &[u8], all_actions: &[Vec<u8>])
    -> Result<ProofWithPublicInputs<F, C, D>, String>
{
    let num_pieces = all_actions.len();
    let l = 55 + num_pieces;
    let num_steps = num_pieces / chunk;   // num_pieces must be a multiple of chunk

    // PHASE 1: one step proof per chunk of `chunk` pieces.
    let mut step_proofs = Vec::new();
    let mut cur_in = base_state_values(init_board, queue, num_pieces);   // first chunk's input
    for s in 0..num_steps {
        let mut pw = PartialWitness::new();
        set_state(&mut pw, &step.in_state, &cur_in);
        // flatten this chunk's actions: pieces [s*chunk .. s*chunk+chunk]
        let mut acts = Vec::with_capacity(32 * chunk);
        for p in 0..chunk { acts.extend_from_slice(&all_actions[s * chunk + p]); }
        set_actions(&mut pw, &step.actions, &acts);
        let proof = step.data.prove(pw).map_err(|e| e.to_string())?;
        cur_in = proof.public_inputs[l..2*l].to_vec();          // out_state → next chunk's input
        step_proofs.push(proof);
    }

    // PHASE 2: fold each step proof into the running aggregate.
    let mut agg_proof = None;
    for k in 0..num_steps {
        let mut pw = PartialWitness::new();
        let _ = pw.set_bool_target(agg.condition, k > 0);
        let _ = pw.set_verifier_data_target(&agg.agg_vd, &agg.data.verifier_only);
        pw.set_proof_with_pis_target::<C, D>(&agg.step_proof, &step_proofs[k]).map_err(|e| e.to_string())?;
        match &agg_proof {
            Some(prev) => { pw.set_proof_with_pis_target::<C, D>(&agg.prev_agg, prev).map_err(|e| e.to_string())?; }
            None => { pw.set_proof_with_pis_target::<C, D>(&agg.prev_agg,
                        &cyclic_base_proof::<F, C, D>(&agg.common, &agg.data.verifier_only, HashMap::new())
                      ).map_err(|e| e.to_string())?; }
        }
        set_base(&mut pw, &agg.base, init_board, queue);
        agg_proof = Some(agg.data.prove(pw).map_err(|e| e.to_string())?);
    }
    Ok(agg_proof.unwrap())
}

fn assert_states_eq(b: &mut CircuitBuilder<F, D>, x: &StepState, y: &StepState) {
    for i in 0..21 { b.connect(x.initial_board.cells[i], y.initial_board.cells[i]); }
    for i in 0..21 { b.connect(x.board.cells[i], y.board.cells[i]); }
    for i in 0..10 { b.connect(x.ledger.ledger[i], y.ledger.ledger[i]); }
    b.connect(x.held_piece, y.held_piece);
    b.connect(x.queue_index, y.queue_index);
    for (a, c) in x.queue.iter().zip(&y.queue) { b.connect(*a, *c); }
}

pub struct AggCircuit {
    data: CircuitData<F, C, D>,
    common: CommonCircuitData<F, D>,
    condition: BoolTarget,
    step_proof: ProofWithPublicInputsTarget<D>,
    prev_agg: ProofWithPublicInputsTarget<D>,
    agg_vd: VerifierCircuitTarget,
    base: StepState,
}

// The skeleton's degree must match the aggregator's, which shifts with the step
// circuit's size (chunk). Auto-tune the padding: try increasing powers of two until
// the cyclic build stops panicking. (Production could hardcode the discovered value.)
pub fn build_aggregator(step: &StepCircuit, num_pieces: usize) -> AggCircuit {
    for pad_bits in 13..=18 {
        let attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            build_aggregator_padded(step, num_pieces, 1 << pad_bits)
        }));
        if let Ok(agg) = attempt { return agg; }
    }
    panic!("build_aggregator: no padding in 2^13..=2^18 matched the aggregator's degree");
}

pub fn build_aggregator_padded(step: &StepCircuit, num_pieces: usize, pad_to: usize) -> AggCircuit {
    let mut b = CircuitBuilder::<F, D>::new(CircuitConfig::standard_recursion_config());
    let l = 55 + num_pieces;

    let agg_out = StepState::new_public(&mut b, num_pieces);
    let agg_vd = b.add_verifier_data_public_inputs();
    let mut common = common_data_for_recursion::<F, C, D>(pad_to);
    common.num_public_inputs = b.num_public_inputs();

    let condition = b.add_virtual_bool_target_safe();  

    let step_proof = b.add_virtual_proof_with_pis(&step.data.common);
    let step_vd = b.constant_verifier_data(&step.data.verifier_only);
    b.verify_proof::<C>(&step_proof, &step_vd, &step.data.common);
    let step_in  = StepState::read(&step_proof.public_inputs[..l], num_pieces);
    let step_out = StepState::read(&step_proof.public_inputs[l..], num_pieces);

    let prev_agg = b.add_virtual_proof_with_pis(&common);
    let prev_out = StepState::read(&prev_agg.public_inputs, num_pieces);
    b.conditionally_verify_cyclic_proof_or_dummy::<C>(condition, &prev_agg, &common).unwrap();

    let base = StepState::base_case(&mut b, num_pieces);
    let expected_in = StepState::select(&mut b, condition, &prev_out, &base);
    assert_states_eq(&mut b, &step_in, &expected_in);

    assert_states_eq(&mut b, &agg_out, &step_out);

    let data = b.build::<C>();
    AggCircuit { data, common, condition, step_proof, prev_agg, agg_vd, base }
}

pub struct StepCircuit {
    data: CircuitData<F, C, D>,
    in_state: StepState,   
    out_state: StepState,
    actions: Vec<Target>,
}

impl StepCircuit {
    // `chunk` = pieces processed per step proof. chunk=1 is pure IVC; larger chunks
    // amortize the aggregation overhead (fewer, fatter proofs) at the cost of more
    // memory per proof. num_pieces must be a multiple of chunk.
    pub fn build(chunk: usize, num_pieces: usize) -> Self {
        let mut b = CircuitBuilder::<F, D>::new(CircuitConfig::standard_recursion_config());
        let in_state  = StepState::new_public(&mut b, num_pieces);   // PIs[0..L]
        let out_state = StepState::new_public(&mut b, num_pieces);   // PIs[L..2L]
        let tables = Tables::default(&mut b);
        let actions = b.add_virtual_targets(32 * chunk);            // chunk pieces, 32 moves each

        // Thread state through `chunk` pieces; induction_step advances queue_index each call.
        let mut state = induction_step(&mut b, tables, &in_state, &actions[0..32]);
        for p in 1..chunk {
            state = induction_step(&mut b, tables, &state, &actions[p * 32..(p + 1) * 32]);
        }
        assert_states_eq(&mut b, &state, &out_state);  // out == computed (index already +chunk)

        let data = b.build::<C>();
        Self { data, in_state, out_state, actions }
    }
}



// Processes ONE piece and advances queue_index by 1, so it can be looped to form
// a chunk. `actions` is exactly 32 entries (this piece's moves).
fn induction_step(
    builder: &mut CircuitBuilder<F, D>,
    tables: Tables,
    step_state: &StepState,
    actions: &[Target]
) -> StepState {
    let one = builder.one();
    let current_target = step_state.queue_index;
    let next_target = builder.add(current_target, one);

    let current_piece = builder.random_access(current_target, step_state.queue.clone());
    let next_piece = builder.random_access(next_target, step_state.queue.clone());

    let piece = spawn(step_state.board, current_piece, next_piece, step_state.held_piece, builder, tables.shapes);
    let mut game_state = GameState::new(builder, step_state.board, piece, next_piece, step_state.held_piece, step_state.ledger);

    for action in actions{
        game_state = game_state.apply_movement(builder, *action, tables);
    }
    game_state = game_state.lock_piece(builder, tables.combo, tables.geq);

    // padding marker = empty/sentinel piece (7): true no-op — keep board/ledger/held,
    // just advance the index. spawn already forces a valid shape + skips its collision.
    let skip_marker = builder.constant(F::from_canonical_usize(7));
    let skip = builder.is_equal(current_piece, skip_marker);
    let board = select_board(builder, skip, &step_state.board, &game_state.board);
    let ledger = select_ledger(builder, skip, &step_state.ledger, &game_state.ledger);
    let held_piece = builder.select(skip, step_state.held_piece, game_state.held_piece);

    StepState {
        initial_board: step_state.initial_board,
        board,
        ledger,
        held_piece,
        queue_index: next_target,        // advanced by 1 (padding still consumes a slot)
        queue: step_state.queue.clone()
    }
}

// select(cond ? when_true : when_false) over a board / ledger, field by field
fn select_board(b: &mut CircuitBuilder<F, D>, cond: BoolTarget, when_true: &BoardTargets, when_false: &BoardTargets) -> BoardTargets {
    BoardTargets { cells: core::array::from_fn(|i| b.select(cond, when_true.cells[i], when_false.cells[i])) }
}
fn select_ledger(b: &mut CircuitBuilder<F, D>, cond: BoolTarget, when_true: &LedgerTargets, when_false: &LedgerTargets) -> LedgerTargets {
    LedgerTargets { ledger: core::array::from_fn(|i| b.select(cond, when_true.ledger[i], when_false.ledger[i])) }
}

struct StepState {
    initial_board: BoardTargets,
    board: BoardTargets,
    ledger: LedgerTargets,
    held_piece: Target,
    queue_index: Target,
    queue: Vec<Target>,
}

impl StepState {
    fn select(b: &mut CircuitBuilder<F, D>, cond: BoolTarget, prev: &StepState, base: &StepState) -> Self {
        StepState {
            initial_board: BoardTargets  { cells:  core::array::from_fn(|i| b.select(cond, prev.initial_board.cells[i], base.initial_board.cells[i])) },
            board:      BoardTargets  { cells:  core::array::from_fn(|i| b.select(cond, prev.board.cells[i],      base.board.cells[i])) },
            ledger:     LedgerTargets { ledger: core::array::from_fn(|i| b.select(cond, prev.ledger.ledger[i],    base.ledger.ledger[i])) },
            held_piece:  b.select(cond, prev.held_piece,  base.held_piece),
            queue_index: b.select(cond, prev.queue_index, base.queue_index),
            queue:      prev.queue.iter().zip(&base.queue).map(|(p, bb)| b.select(cond, *p, *bb)).collect(),
        }
    }

    fn new_public(builder: &mut CircuitBuilder<F, D>, num_pieces: usize) -> Self {
        let state = Self {
            initial_board: BoardTargets { cells: builder.add_virtual_target_arr() },
            board: BoardTargets { cells: builder.add_virtual_target_arr() },
            ledger: LedgerTargets { ledger: builder.add_virtual_target_arr() },
            held_piece: builder.add_virtual_target(),
            queue_index: builder.add_virtual_target(),
            queue: (0..num_pieces + 1).map(|_| builder.add_virtual_target()).collect()
        };
        state.register(builder);
        state
    }

    fn base_case(builder: &mut CircuitBuilder<F, D>, num_pieces: usize) -> Self {
        let zero = builder.zero();
        let seven = builder.constant(F::from_canonical_u16(7));
        let board = BoardTargets { cells: builder.add_virtual_target_arr() };
        let mut queue: Vec<Target> = (0..num_pieces).map(|_| builder.add_virtual_target()).collect();
        queue.push(seven);
        Self {
            initial_board: board,
            board: board,
            ledger: LedgerTargets { ledger: [builder.zero(); 10] },
            held_piece: seven,
            queue_index: zero,
            queue: queue
        }
    }

    fn register(&self, builder: &mut CircuitBuilder<F, D>) {
        builder.register_public_inputs(&self.initial_board.cells);
        builder.register_public_inputs(&self.board.cells);
        builder.register_public_inputs(&self.ledger.ledger);
        builder.register_public_input(self.held_piece);
        builder.register_public_input(self.queue_index);
        builder.register_public_inputs(&self.queue);
    }

    fn read(pis: &[Target], num_pieces: usize) -> Self {
        Self { 
            initial_board: BoardTargets { cells: pis[0..21].try_into().unwrap() }, 
            board: BoardTargets { cells: pis[21..42].try_into().unwrap() }, 
            ledger: LedgerTargets { ledger: pis[42..52].try_into().unwrap() }, 
            held_piece: pis[52],
            queue_index: pis[53], 
            queue: pis[54..(54 + num_pieces + 1)].to_vec(), 
        }
    }

}


#[derive(Debug, Clone)]
struct GameState {
    board: BoardTargets,
    current_piece: PieceStateTargets,
    last_action_was_rotation: BoolTarget,
    ledger: LedgerTargets,
    held_piece: Target,
    next_piece: Target,
}

impl GameState {
    fn new(
        builder: &mut CircuitBuilder<F, D>, 
        board: BoardTargets, 
        piece: PieceStateTargets,
        next_piece: Target,
        held_piece: Target,
        ledger: LedgerTargets
    ) -> Self{
        GameState { 
            board: board,  
            current_piece: piece, 
            last_action_was_rotation: builder._false(), 
            ledger: ledger,
            held_piece: held_piece,
            next_piece: next_piece,
        }
    }

    fn apply_movement(
        &self, 
        builder: &mut CircuitBuilder<F, D>, 
        action: Target, // left right cw ccw sd hold
        tables: Tables
    ) -> Self{
        let zero = builder.zero();
        let one = builder.one();
        let two = builder.constant(F::from_canonical_usize(2));
        let three = builder.constant(F::from_canonical_usize(3));
        let four = builder.constant(F::from_canonical_usize(4));
        let five = builder.constant(F::from_canonical_usize(5));

        let current_piece = self.current_piece;
        let board = self.board;
        let mut last_action_rotate = self.last_action_was_rotation;

        let is_left = builder.is_equal(zero,action);
        let is_right = builder.is_equal(action, one);
        let is_shift = builder.or(is_left,is_right);
        let is_cw = builder.is_equal(action, two);
        let is_ccw = builder.is_equal(action, three);
        let is_rotate = builder.or(is_ccw, is_cw);
        let is_sd = builder.is_equal(action, four);
        let is_hold = builder.is_equal(action, five);

        let (shifted_piece, shift_ok) = current_piece.shift(builder, board, is_right);
        let (sd_piece,sd_ok) = current_piece.soft_drop(builder, board);
        let (rotated_piece, rotate_ok) = current_piece.rotate(builder, board, is_cw, tables);
        let (swapped_piece, piece_in_hold) = self.use_hold(builder, tables.shapes);

        let shifted = builder.and(is_shift,shift_ok);
        let didnt_shift = builder.not(shifted);
        let rotated = builder.and(is_rotate, rotate_ok);
        let moved_sd = builder.and(is_sd, sd_ok);
        let didnt_sd = builder.not(moved_sd);

        last_action_rotate = builder.and(didnt_shift, last_action_rotate);
        last_action_rotate = builder.and(didnt_sd, last_action_rotate);
        last_action_rotate = builder.or(rotated, last_action_rotate);

        let mut adjusted_piece = current_piece;
        adjusted_piece = select_piece_state(builder, is_shift, shifted_piece, adjusted_piece);
        adjusted_piece = select_piece_state(builder, rotated, rotated_piece, adjusted_piece);
        adjusted_piece = select_piece_state(builder, is_sd, sd_piece, adjusted_piece);
        adjusted_piece = select_piece_state(builder, is_hold, swapped_piece, adjusted_piece);

        GameState { 
            board: board, 
            current_piece: adjusted_piece, 
            last_action_was_rotation: last_action_rotate, 
            ledger: self.ledger,
            held_piece: builder.select(is_hold, piece_in_hold, self.held_piece),
            next_piece: self.next_piece,
        }
    }


    fn lock_piece(&self, builder: &mut CircuitBuilder<F, D>, combo_table: usize, geq_table: usize) -> GameState {
        let board = self.board;
        let (adjusted_piece, droppable) = self.current_piece.hard_drop(builder, board);
        let not_droppable = builder.not(droppable);
        let last_action_rotate = builder.and(self.last_action_was_rotation, not_droppable);
        let old_ledger = self.ledger.ledger;
        let three_corners = adjusted_piece.three_corners(builder, board);
        let is_tspin = builder.and(three_corners, last_action_rotate);
        let twenty_six = builder.constant(F::from_canonical_usize(26));
        let seven = builder.constant(F::from_canonical_usize(7));

        let placed_board = board.place(builder, adjusted_piece);
        let (cleared_board, lines_cleared) = placed_board.clear_lines(builder);

        let mut attack = builder.zero();
        let mut is = [builder._false(); 5];
        let mut is_ts = [builder._false(); 5];
        for i in 0..5 {
            let clear_constant = builder.constant(F::from_canonical_usize(i));
            is[i] = builder.is_equal(clear_constant, lines_cleared);
            is_ts[i] = builder.and(is_tspin, is[i]);
            attack = builder.mul_const_add(F::from_canonical_usize(ATTACK_TABLE[i]), is[i].target, attack);
            attack = builder.mul_const_add(F::from_canonical_usize(TSPIN_REWARD[i]), is_ts[i].target, attack);
        }

        let keep_b2b = builder.or(is[4], is_tspin);
        attack = builder.mul_add(keep_b2b.target, old_ledger[9], attack);

        let is_pc = cleared_board.check_empty(builder);
        let ten = builder.constant(F::from_canonical_usize(10));
        attack = builder.mul_add(is_pc.target, ten, attack);
        
        let add_combo = builder.not(is[0]);
        let combo_attack = builder.add_lookup_from_index(old_ledger[8], combo_table);
        attack = builder.mul_add(add_combo.target, combo_attack, attack);

        let new_combo = builder.mul_add(old_ledger[8], add_combo.target, add_combo.target);
        let combo_index = builder.mul_add(new_combo, twenty_six, old_ledger[6]);
        let is_max_combo = builder.add_lookup_from_index(combo_index, geq_table);

        let hold_empty = builder.is_equal(self.held_piece, seven);
        let hold_full = builder.not(hold_empty);
        let held_used = builder.or(hold_full, BoolTarget::new_unsafe(old_ledger[7]));

        let new_ledger = LedgerTargets{ ledger:
            [
                builder.add(old_ledger[0], is_ts[1].target),
                builder.add(old_ledger[1], is_ts[2].target),
                builder.add(old_ledger[2], is_ts[3].target),
                builder.add(old_ledger[3], is[4].target),
                builder.add(old_ledger[4], is_pc.target),
                builder.add(old_ledger[5], attack),
                builder.select(BoolTarget::new_unsafe(is_max_combo), new_combo, old_ledger[6]),
                held_used.target,
                new_combo,
                builder.select(is[0], old_ledger[9], keep_b2b.target)
            ]
        };

        GameState { 
            board: cleared_board, 
            current_piece: adjusted_piece, 
            last_action_was_rotation: builder._false(), 
            ledger: new_ledger,
            held_piece: self.held_piece,
            next_piece: self.next_piece,
        }
    }

    fn use_hold(&self, 
        builder: &mut CircuitBuilder<F, D>, 
        shape_table: usize 
    ) -> (PieceStateTargets, Target) {
        let zero = builder.zero();
        let one = builder.one();
        let thirteen = builder.constant(GoldilocksField(13));
        let fourteen = builder.constant(GoldilocksField(14));
        let null_target = builder.constant(F::from_canonical_usize(7));
        let hold_target = self.held_piece;
        let next_target = self.next_piece;
        let hold_null = builder.is_equal(null_target, hold_target);
        let target_to_spawn = builder.select(hold_null, next_target, hold_target);
        let o_to_spawn = builder.is_equal(target_to_spawn, one);
        let spawned_piece = PieceStateTargets{
            piece: target_to_spawn,
            rotation: zero,
            shape: get_shape(builder, target_to_spawn, zero, shape_table),
            row: zero,
            col: builder.select(o_to_spawn, fourteen, thirteen),
        };

        let game_okay = self.board.no_collision(builder, spawned_piece.shape, zero, spawned_piece.col);
        builder.assert_one(game_okay.target);

        (
            spawned_piece,
            self.current_piece.piece
        )
    }

}


#[derive(Debug, Clone, Copy)]
pub struct BoardTargets{
    cells: [Target; 21]
}

impl BoardTargets{

    fn out_of_bounds(&self, builder: &mut CircuitBuilder<F, D>, row: Target, col: Target) -> BoolTarget {
        let zero = builder.zero();
        let eight = builder.constant(F::from_canonical_usize(8));
        let nine = builder.constant(F::from_canonical_usize(9));
        let twenty = builder.constant(F::from_canonical_usize(20));
        let twenty_one = builder.constant(F::from_canonical_usize(21));
        let twenty_two = builder.constant(F::from_canonical_usize(22));
        let add_one = builder.add_const(row, F::ONE);
        let add_two = builder.add_const(row, F::TWO);

        let col_eight = builder.is_equal(col, eight);
        let col_nine = builder.is_equal(col, nine);
        let col_twenty = builder.is_equal(col, twenty);
        let col_twenty_one = builder.is_equal(col, twenty_one);

        let row_neg_one = builder.is_equal(add_one, zero);
        let row_neg_two = builder.is_equal(add_two, zero);
        let row_twenty_one = builder.is_equal(row, twenty_one);
        let row_twenty_two = builder.is_equal(row, twenty_two);

        let bad_col = builder.or(col_eight, col_nine);
        let bad_col = builder.or(bad_col, col_twenty);
        let bad_col = builder.or(bad_col, col_twenty_one);

        let bad_row = builder.or(row_neg_one, row_neg_two);
        let bad_row = builder.or(bad_row, row_twenty_one);
        let bad_row = builder.or(bad_row, row_twenty_two);

        builder.or(bad_col, bad_row)
    }

    fn block_collision(&self, builder: &mut CircuitBuilder<F, D>, row: Target, col: Target) -> BoolTarget {
        let cells = self.cells;
        let ten = builder.constant(F::from_canonical_usize(10));

        let not_bounded = self.out_of_bounds(builder, row, col);
        let bounded = builder.not(not_bounded);
        let safe_row = builder.mul(row, bounded.target);

        let row_value = builder.random_access(safe_row, cells.to_vec());
        let bits = builder.split_le(row_value, 10);

        let col_idx = builder.sub(col,ten);
        let safe_col = builder.mul(col_idx, bounded.target);
        let collision = builder.random_access(safe_col, bits.iter().map(|b|b.target).collect());

        builder.or(BoolTarget::new_unsafe(collision), not_bounded)
    }

    fn no_collision(&self, builder:&mut CircuitBuilder<F, D>, shape: [[Target;2];4], row: Target, col: Target) -> BoolTarget {
        let mut any_collision = builder._false();

        for block in 0..4 {
            let piece_row = builder.add(row,shape[block][1]); // these are flipped because 
            let piece_col = builder.add(col,shape[block][0]); // in the table they're x and y

            let collision = self.block_collision(builder, piece_row, piece_col);
            any_collision = builder.or(any_collision, collision);
        }
        builder.not(any_collision)
    }

    fn place(&self, builder: &mut CircuitBuilder<F, D>, piece_state: PieceStateTargets) -> BoardTargets {
        let mut cells = self.cells;
        let shape = piece_state.shape;
        for block in 0..4 {
            let piece_row = builder.add(piece_state.row,shape[block][1]);
            let piece_col = builder.add(piece_state.col,shape[block][0]);
            let col_mask = col_to_mask(builder, piece_col);

            for board_row in 0..21 {
                let board_target = builder.constant(F::from_canonical_usize(board_row));
                let is_row = builder.is_equal(board_target, piece_row);
                let contribution = builder.mul(is_row.target, col_mask);
                cells[board_row] = builder.add( contribution, cells[board_row]);
            }
        }
        BoardTargets { cells }
    }

    fn full_lines_under(&self, builder: &mut CircuitBuilder<F, D>) -> ([Target; 21], [BoolTarget; 21]) {
        let cells = self.cells;
        let mut counter = [builder.zero(); 21];
        let mut full_counter = [builder._false(); 21];
        let full_example = builder.constant(F::from_canonical_u16(1023));
        for board_row in (1..21).rev(){
            let full_row = builder.is_equal(full_example, cells[board_row]);
            full_counter[board_row] = full_row;
            counter[board_row - 1] = builder.add(counter[board_row], full_row.target);
        }
        (counter, full_counter)
    }


    fn clear_lines(&self, builder: &mut CircuitBuilder<F, D>) -> (BoardTargets, Target)  {
        let old_board = self.cells;
        let mut new_board = [builder.zero(); 21];

        let (cumulative, full_vec) = self.full_lines_under(builder);

        for new_row in (0..21).rev() {
            let new_t = builder.constant(F::from_canonical_usize(new_row));
            for shift in 0..5 {
                if shift > new_row { break; }
                let old_row = new_row - shift; 
                let old_t = builder.constant(F::from_canonical_usize(old_row));
                let dest = builder.add(old_t, cumulative[old_row]);
                let is_dest = builder.is_equal(dest, new_t);
                let not_full = builder.not(full_vec[old_row]);
                let write_this = builder.and(is_dest, not_full);
                new_board[new_row] = builder.select(write_this, old_board[old_row], new_board[new_row]);
            }
        }
        (BoardTargets{ cells: new_board }, cumulative[0])
    }

    fn check_empty(&self, builder: &mut CircuitBuilder<F, D>) -> BoolTarget {
        let mut empty_board = builder._true();
        let zero = builder.zero();
        for row in 0..21 {
            let empty_row = builder.is_equal(self.cells[row], zero);
            empty_board = builder.and(empty_board,empty_row);
        }
        empty_board
    }


}

const ATTACK_TABLE: [usize; 5] = [0, 0, 1, 2, 4];
const TSPIN_REWARD: [usize; 5] = [0, 2, 3, 4, 0];
const COMBO_TABLE: [usize; 25] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];


const PIECE_SHAPE: [[[[u32; 2]; 4]; 4]; 8] = [
    [ // I piece
        [[0, 1], [1, 1], [2, 1], [3, 1]],
        [[2, 0], [2, 1], [2, 2], [2, 3]],
        [[0, 2], [1, 2], [2, 2], [3, 2]],
        [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],

    [ // O piece
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],

    [ // T piece
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [1, 2]],
        [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],

    [ // S piece
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[1, 0], [1, 1], [2, 1], [2, 2]],
        [[1, 1], [2, 1], [0, 2], [1, 2]],
        [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],

    [ // Z piece
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[2, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [1, 2], [2, 2]],
        [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],

    [ // L piece
        [[2, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [1, 2], [2, 2]],
        [[0, 1], [1, 1], [2, 1], [0, 2]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],

    [ // J piece
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [2, 2]],
        [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
        [ // null piece
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],

];


pub const KICK_TABLES: [[[[i32; 2]; 5]; 8]; 2] = [[
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],],
    [
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
]];


#[derive(Debug, Clone, Copy)]
struct PieceStateTargets{
    piece: Target, //// I O T S Z L J
    rotation: Target,
    shape: [[Target;2];4],
    row: Target,
    col: Target,
}

impl PieceStateTargets{
    fn shift(
        &self, 
        builder: &mut CircuitBuilder<F, D>, 
        board: BoardTargets, 
        is_right: BoolTarget
    ) -> (PieceStateTargets, BoolTarget) {
        let is_left = builder.not(is_right);
        let mut new_col = builder.add(self.col, is_right.target);
        new_col = builder.sub(new_col, is_left.target);
        let shape = self.shape;
        let shiftable = board.no_collision(builder, shape, self.row, new_col);

        (PieceStateTargets { 
            piece: self.piece, 
            rotation: self.rotation, 
            shape: shape,
            row: self.row, 
            col: builder.select(shiftable, new_col, self.col),
        },
        shiftable)
    }

    fn soft_drop(&self, builder: &mut CircuitBuilder<F, D>, board: BoardTargets) -> (PieceStateTargets, BoolTarget) {
        let one = builder.constant(F::from_canonical_usize(1));
        let new_row = builder.add(self.row, one);
        let shape = self.shape;
        let shiftable = board.no_collision(builder, shape, new_row, self.col);

        (
            PieceStateTargets { 
                piece: self.piece, 
                rotation: self.rotation, 
                shape: shape,
                row: builder.add(self.row, shiftable.target),
                col: self.col,
            },
            shiftable
        )
    }

    fn hard_drop(&self, builder: &mut CircuitBuilder<F, D>, board: BoardTargets) -> (PieceStateTargets, BoolTarget) {
        let mut total_shifted = builder._false();
        let mut piece = *self;
        
        for _ in 0..19 {
            let (next_state, shifted) = piece.soft_drop(builder, board);
            total_shifted = builder.or(total_shifted,shifted);
            piece = next_state;
        }

        (piece, total_shifted)
    }

    fn rotate(
        &self, 
        builder: &mut CircuitBuilder<F, D>, 
        board: BoardTargets, 
        is_cw: BoolTarget,
        tables: Tables
    ) -> (PieceStateTargets, BoolTarget) {

        let mut found = builder._false();
        let mut final_row = self.row;
        let mut final_col = self.col;
        let initial_rotation = self.rotation;
        

        let zero = builder.zero();
        let one = builder.one();
        let two = builder.constant(F::from_canonical_usize(2));
        let four = builder.constant(F::from_canonical_usize(4));
        let five = builder.constant(F::from_canonical_usize(5));
        let ten = builder.constant(F::from_canonical_usize(10));
        let eighty = builder.constant(F::from_canonical_usize(80));

        let is_ccw = builder.not(is_cw);
        let is_zero = builder.is_equal(zero, initial_rotation);
        let will_underflow = builder.and(is_zero, is_ccw);


        let mut target_rotation = builder.add(initial_rotation, is_cw.target);
        let is_four = builder.is_equal(four, target_rotation);
        target_rotation = builder.select(is_four, zero, target_rotation);
        target_rotation = builder.select(will_underflow, four, target_rotation);
        target_rotation = builder.sub(target_rotation, is_ccw.target);

        let shape_coord = get_shape(builder, self.piece, target_rotation, tables.shapes);
        
        let is_i = builder.is_equal(zero, self.piece);
        let is_o = builder.is_equal(self.piece, one);
        let not_o = builder.not(is_o);

        let piece_index = builder.mul(is_i.target, eighty);
        let rotation_index = builder.mul_add(initial_rotation, two, is_cw.target);
        let pr_index = builder.mul_add(rotation_index, ten, piece_index);

        for kick in 0..5{
            let kick_t = builder.constant(F::from_canonical_usize(kick));
            let kick_index = builder.mul_add(kick_t, two, pr_index);
            let dy_index = builder.add(kick_index, one);
            let shifted_dx = builder.add_lookup_from_index(kick_index, tables.kicks);
            let shifted_dy = builder.add_lookup_from_index(dy_index, tables.kicks);
            let dx = builder.sub(shifted_dx, five);
            let dy = builder.sub(shifted_dy, five);
            let not_o_dx = builder.mul(dx, not_o.target);
            let not_o_dy = builder.mul(dy, not_o.target);
            let try_row = builder.sub(self.row, not_o_dy);
            let try_col = builder.add(self.col, not_o_dx);
            

            let works = board.no_collision(builder, shape_coord, try_row, try_col);
            let not_found = builder.not(found);
            let update_pos = builder.and(works, not_found);

            final_row = builder.select(update_pos, try_row, final_row);
            final_col = builder.select(update_pos, try_col, final_col);
            found = builder.or(found,update_pos);
        }
        
        let final_rotation = builder.select(found, target_rotation, initial_rotation);
        (
            PieceStateTargets { 
                piece: self.piece, 
                rotation: final_rotation, 
                shape: shape_coord, 
                row: final_row, 
                col: final_col,
            }, 
            found
        )
    }

    fn three_corners(&self, builder:&mut CircuitBuilder<F, D>, board: BoardTargets) -> BoolTarget {
        let mut num_collisions = builder.zero();
        let row = self.row;
        let col = self.col;
        
        let zero = builder.zero();
        let two = builder.constant(F::from_canonical_usize(2));
        let three = builder.constant(F::from_canonical_usize(3));
        let four = builder.constant(F::from_canonical_usize(4));

        let shape = [[zero,zero],[two,zero],[zero,two],[two,two]];
        for block in 0..4 {
            let piece_row = builder.add(row,shape[block][1]);
            let piece_col = builder.add(col,shape[block][0]);

            let collision = board.block_collision(builder, piece_row, piece_col);

            num_collisions = builder.add(num_collisions, collision.target);
        }
        let is_three = builder.is_equal(num_collisions, three);
        let is_four = builder.is_equal(num_collisions, four);
        let is_t = builder.is_equal(self.piece, two);
        let surrounded = builder.or(is_three, is_four);
        builder.and(is_t, surrounded)
    }


}

#[derive(Debug, Clone, Copy)]
pub struct LedgerTargets{
    ledger: [Target; 10], //tss, tsd, tst, tetris, pc, attack, max_combo, held, combo, b2b
}

impl LedgerTargets{
    fn empty(builder: &mut CircuitBuilder<F, D>) -> Self{
        LedgerTargets{ ledger: [builder.zero(); 10] }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Spread pieces across columns (move right by k) so all-drop moves don't stack
    // into a spawn collision.
    fn spread_actions(num_pieces: usize) -> Vec<Vec<u8>> {
        (0..num_pieces).map(|k| {
            let mut a = vec![1u8; k % 8];   // 1 = RIGHT
            a.resize(32, 6);                // pad with NOOP
            a
        }).collect()
    }

    // 1) The heavy step circuit builds (plain, non-cyclic — should always work).
    #[test]
    fn step_circuit_builds() {
        let _step = StepCircuit::build(1, 2);
    }

    // 2) The cyclic aggregator builds. build_aggregator auto-tunes the skeleton padding
    //    to match its degree, so this works regardless of chunk size.
    #[test]
    fn aggregator_builds() {
        let step = StepCircuit::build(1, 2);
        let _agg = build_aggregator(&step, 2);
    }

    // 3) Full pipeline, chunk=1: 2 step proofs + 2 aggregations, then verifier binding.
    #[test]
    fn prove_and_verify_two_pieces() {
        let num_pieces = 2;
        let board = [0u8; 210];
        let queue = [0u8, 1u8];
        let requirements = [0u8; 8];
        let all_actions = vec![vec![6u8; 32], vec![6u8; 32]];

        let step = StepCircuit::build(1, num_pieces);
        let agg = build_aggregator(&step, num_pieces);

        let proof = prove_solution(&step, &agg, 1, &board, &queue, &all_actions)
            .expect("prove_solution failed");

        verify_solution(&agg, proof, &board, &queue, &requirements, num_pieces)
            .expect("verify_solution failed");
    }

    // Soundness: a valid proof must NOT verify against a different puzzle.
    #[test]
    fn binding_rejects_tampering() {
        let num_pieces = 2;
        let board = [0u8; 210];
        let queue = [0u8, 1u8];
        let requirements = [0u8; 8];
        let all_actions = vec![vec![6u8; 32], vec![6u8; 32]];

        let step = StepCircuit::build(1, num_pieces);
        let agg = build_aggregator(&step, num_pieces);
        let proof = prove_solution(&step, &agg, 1, &board, &queue, &all_actions).unwrap();

        assert!(verify_solution(&agg, proof.clone(), &board, &queue, &requirements, num_pieces).is_ok());

        let wrong_queue = [2u8, 3u8];
        assert!(verify_solution(&agg, proof.clone(), &board, &wrong_queue, &requirements, num_pieces).is_err());

        let mut wrong_board = [0u8; 210];
        wrong_board[0] = 1;
        assert!(verify_solution(&agg, proof, &wrong_board, &queue, &requirements, num_pieces).is_err());
    }

    // Scaling: 10 pieces (past the monolithic OOM point) at chunk=1, bounded memory.
    #[test]
    fn scales_to_ten_pieces() {
        let num_pieces = 10;
        let board = [0u8; 210];
        let queue: Vec<u8> = (0..num_pieces).map(|i| (i % 7) as u8).collect();
        let requirements = [0u8; 8];
        let all_actions = spread_actions(num_pieces);

        let step = StepCircuit::build(1, num_pieces);
        let agg = build_aggregator(&step, num_pieces);

        let proof = prove_solution(&step, &agg, 1, &board, &queue, &all_actions)
            .expect("prove_solution failed at 10 pieces");
        verify_solution(&agg, proof, &board, &queue, &requirements, num_pieces)
            .expect("verify_solution failed at 10 pieces");
    }

    // Chunking: 2 pieces per step proof. 4 pieces → 2 fat step proofs + 2 aggregations
    // (vs 4 + 4 at chunk=1). Verifies the chunked step circuit + harness are correct.
    #[test]
    fn chunked_two_per_step() {
        let chunk = 2;
        let num_pieces = 4;
        let board = [0u8; 210];
        let queue: Vec<u8> = (0..num_pieces).map(|i| (i % 7) as u8).collect();
        let requirements = [0u8; 8];
        let all_actions = spread_actions(num_pieces);

        let step = StepCircuit::build(chunk, num_pieces);
        let agg = build_aggregator(&step, num_pieces);

        let proof = prove_solution(&step, &agg, chunk, &board, &queue, &all_actions)
            .expect("chunked prove_solution failed");
        verify_solution(&agg, proof, &board, &queue, &requirements, num_pieces)
            .expect("chunked verify_solution failed");
    }

    // No-op padding: a chunk of 8 with only 3 real pieces, padded by 5 sentinel (7) pieces.
    // Padding must be skipped (no state change, no spawn collision) for this to prove.
    #[test]
    fn padding_pieces_are_noop() {
        let chunk = 8;
        let num_pieces = 8;                       // 3 real + 5 padding, one chunk
        let board = [0u8; 210];
        let mut queue = vec![0u8, 1u8, 2u8];      // 3 real pieces
        queue.resize(num_pieces, 7u8);            // pad with sentinel 7
        let requirements = [0u8; 8];
        let all_actions: Vec<Vec<u8>> = (0..num_pieces).map(|_| vec![6u8; 32]).collect();

        let step = StepCircuit::build(chunk, num_pieces);
        let agg = build_aggregator(&step, num_pieces);
        let proof = prove_solution(&step, &agg, chunk, &board, &queue, &all_actions)
            .expect("padded prove_solution failed");
        verify_solution(&agg, proof, &board, &queue, &requirements, num_pieces)
            .expect("padded verify_solution failed");
    }

    // pad_puzzle: a real 5-piece puzzle auto-padded to a multiple of chunk=8, proved+verified.
    #[test]
    fn pads_and_proves() {
        let chunk = 8;
        let board = [0u8; 210];
        let real_queue: Vec<u8> = vec![0, 1, 2, 3, 4];        // 5 real pieces
        let real_actions = spread_actions(real_queue.len());
        let requirements = [0u8; 8];

        let (queue, all_actions) = pad_puzzle(&real_queue, &real_actions, chunk);
        let num_pieces = queue.len();                          // 8 after padding
        assert_eq!(num_pieces, 8);

        let step = StepCircuit::build(chunk, num_pieces);
        let agg = build_aggregator(&step, num_pieces);
        let proof = prove_solution(&step, &agg, chunk, &board, &queue, &all_actions)
            .expect("padded prove failed");
        verify_solution(&agg, proof, &board, &queue, &requirements, num_pieces)
            .expect("padded verify failed");
    }

    // Speed benchmark across chunk sizes on the same 8-piece puzzle.
    // Run: cargo test -p circuit --release bench_chunks -- --ignored --nocapture
    // `prove(ms)` is the per-puzzle cost that matters; `build(ms)` is one-time at startup.
    #[test]
    #[ignore]
    fn bench_chunks() {
        let num_pieces = 8;                       // divisible by 1,2,4,8
        let board = [0u8; 210];
        let queue: Vec<u8> = (0..num_pieces).map(|i| (i % 7) as u8).collect();
        let all_actions = spread_actions(num_pieces);

        println!("\nchunk | steps | build(ms) | prove(ms)");
        for &chunk in &[1usize, 2, 4, 8] {
            let t = std::time::Instant::now();
            let step = StepCircuit::build(chunk, num_pieces);
            let agg = build_aggregator(&step, num_pieces);
            let build_ms = t.elapsed().as_millis();

            let t = std::time::Instant::now();
            let _ = prove_solution(&step, &agg, chunk, &board, &queue, &all_actions).unwrap();
            let prove_ms = t.elapsed().as_millis();

            println!("{:5} | {:5} | {:9} | {:9}", chunk, num_pieces / chunk, build_ms, prove_ms);
        }
    }

    // Discover the aggregator pad per recursive padded-length at chunk=4 (for hardcoding
    // in the wasm builder, where catch_unwind/auto-tune doesn't work).
    // Run: cargo test -p circuit --release discover_pads -- --ignored --nocapture
    #[test]
    #[ignore]
    fn discover_pads() {
        let chunk = 4;
        for &len in &[12usize, 16, 20, 24] {
            let step = StepCircuit::build(chunk, len);
            for pad_bits in 12..=18 {
                let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    build_aggregator_padded(&step, len, 1 << pad_bits)
                })).is_ok();
                if ok { println!("PAD: chunk=4 len={} pad_bits={}", len, pad_bits); break; }
            }
        }
    }

    // Real 11-piece puzzle, padded each way: chunk 4 -> 12 (3 steps) vs chunk 8 -> 16 (2 steps).
    // Run: cargo test -p circuit --release bench_pad_11 -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_pad_11() {
        let real_queue: Vec<u8> = (0..11).map(|i| (i % 7) as u8).collect();
        let real_actions = spread_actions(11);
        let board = [0u8; 210];

        for &chunk in &[4usize, 8] {
            let (queue, all_actions) = pad_puzzle(&real_queue, &real_actions, chunk);
            let padded = queue.len();

            let t = std::time::Instant::now();
            let step = StepCircuit::build(chunk, padded);
            let agg = build_aggregator(&step, padded);
            let build_ms = t.elapsed().as_millis();

            let t = std::time::Instant::now();
            let _ = prove_solution(&step, &agg, chunk, &board, &queue, &all_actions).unwrap();
            let prove_ms = t.elapsed().as_millis();

            println!("BENCH: real=11 chunk={} padded={} steps={} build={}ms prove={}ms",
                     chunk, padded, padded / chunk, build_ms, prove_ms);
        }
    }
}