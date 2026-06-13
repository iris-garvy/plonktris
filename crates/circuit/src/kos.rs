use plonky2::field::types::{Field};
use plonky2::iop::target::{BoolTarget, Target};
use plonky2::plonk::circuit_builder::{CircuitBuilder};
use plonky2::field::goldilocks_field::GoldilocksField;
use plonky2::plonk::circuit_data::CircuitConfig;
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::config::PoseidonGoldilocksConfig;

pub fn generate_proof(board: &Vec<u8>, queue: &Vec<u8>, requirements: &Vec<u8>, secret_moves: &Vec<u8>) -> Result<Vec<u8>,String> {
    let config = CircuitConfig::standard_recursion_config();
    let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);

    let num_pieces = queue.len();
    let bits_t = deserialize_board(&mut builder);
    let board_t = bits_to_board(&mut builder, bits_t).unwrap();
    let queue_t = deserialize_queue(&mut builder, num_pieces + 1); //for hold sentinel
    let req_t = deserialize_requirements(&mut builder);
    let actions_t = deserialize_actions(&mut builder, num_pieces);

    let mut pw = PartialWitness::new();

    for (i, &byte) in board.iter().enumerate() {
        pw.set_target(bits_t[i], GoldilocksField::from_canonical_u8(byte)).unwrap();
    }

    for (i, &piece) in queue.iter().enumerate() {
        pw.set_target(queue_t[i], GoldilocksField::from_canonical_u8(piece)).unwrap();
    }
    pw.set_target(queue_t[num_pieces],GoldilocksField::from_canonical_usize(7)).unwrap();

    for (i, &req) in requirements.iter().enumerate() {
        pw.set_target(req_t[i], GoldilocksField::from_canonical_u8(req)).unwrap();
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
    let proof = data.prove(pw).map_err(|e| e.to_string())?;
    let proof_bytes = proof.to_bytes();
    eprintln!("num public inputs: {}", data.common.num_public_inputs);
    Ok(proof_bytes)
}

pub fn deserialize_requirements(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> [Target; 8] {
    builder.add_virtual_public_input_arr()
}

pub fn verify_requirements(
    builder: &mut CircuitBuilder<GoldilocksField, 2>, 
    requirements: [Target; 8], 
    ledger_struct: LedgerTargets,
) {
    let ledger = ledger_struct.ledger;
    let mut difference = [builder.zero(); 7];
    let one = builder.one();

    for i in 0..7 {
    difference[i] = builder.sub(ledger[i], requirements[i]);
    }
    for req in 0..7 {
        builder.range_check(difference[req], 7);
    }
    let check_hold = builder.is_equal(requirements[7], one);
    let hold_bad = builder.mul(check_hold.target, ledger[7]);
    builder.assert_zero(hold_bad);
}

pub fn deserialize_board(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> [Target;210] {
    builder.add_virtual_public_input_arr()
}

pub fn bits_to_board(builder: &mut CircuitBuilder<GoldilocksField, 2>, bits: [Target;210]) -> Result<BoardTargets, String> {
    let mut cells = [builder.zero(); 21];
    let mut column_mask= [builder.zero(); 10];

    for c in 0..10 {
        column_mask[c] = builder.constant(GoldilocksField(1 << c));
    }

    for row in 0..21 {
        for col in 0..10 {
            cells[row] = builder.mul_add(column_mask[col], bits[row*10+col], cells[row]);
        }
    }
    Ok(BoardTargets { cells: cells })
}

pub fn deserialize_queue(builder: &mut CircuitBuilder<GoldilocksField, 2>, queue_length: usize) -> Vec<Target> {
    let mut queue_targets = Vec::new();
    for _ in 0..queue_length {
        queue_targets.push(builder.add_virtual_public_input());
    }
    queue_targets
}

pub fn deserialize_actions(builder: &mut CircuitBuilder<GoldilocksField, 2>, queue_length: usize) -> Vec<Vec<Target>>{
    let mut action_targets = Vec::new();
    for piece in 0..queue_length{
        action_targets.push(Vec::new());
        for _ in 0..32 {
            action_targets[piece].push(builder.add_virtual_target());
        }
    }
    action_targets
}

pub fn simulate(
    builder: &mut CircuitBuilder<GoldilocksField, 2>, 
    board: BoardTargets, 
    queue: &Vec<Target>, 
    actions: &Vec<Vec<Target>>
) -> LedgerTargets {
    let mut queue_index = 0;
    let mut board = board;
    let mut ledger = LedgerTargets::empty(builder);
    let mut held_piece = builder.constant(GoldilocksField::from_canonical_usize(7));
    let tables = Tables::default(builder);
    let num_possible_pieces = queue.len() - 1;

    while queue_index < num_possible_pieces {
        let piece = spawn(board,queue[queue_index],
        queue[queue_index+1], held_piece, builder, tables.shapes);

        let mut game_state = GameState::new(builder, board, piece, 
        queue[queue_index+1], held_piece, ledger);

        for action in &actions[queue_index] {
            game_state = game_state.apply_movement(builder, *action, tables);
        }
        game_state = game_state.lock_piece(builder, tables.combo, tables.geq);
        board = game_state.board;
        ledger = game_state.ledger;
        held_piece = game_state.held_piece;
        queue_index += 1;
    }
    ledger
}

fn spawn(
    board: BoardTargets,
    current_piece: Target, 
    next_piece: Target,
    held_piece: Target,
    builder: &mut CircuitBuilder<GoldilocksField, 2>, 
    shape_table: usize
) -> PieceStateTargets {
    let zero = builder.zero();
    let one = builder.one();
    let null_target = builder.constant(GoldilocksField::from_canonical_usize(7));

    let hold_null = builder.is_equal(held_piece, null_target);
    let current_null = builder.is_equal(current_piece, null_target);
    let both_null = builder.and(hold_null, current_null);

    let mut letter = builder.select(hold_null, current_piece, next_piece);
    letter = builder.select(current_null, held_piece, letter);
    letter = builder.select(both_null, one, letter);

    let is_one = builder.is_equal(letter, one);
    let fourteen = builder.constant(GoldilocksField::from_canonical_usize(14));
    let thirteen = builder.constant(GoldilocksField::from_canonical_usize(13));

    let piece_shape = get_shape(builder, letter, zero, shape_table);
    let piece_state = PieceStateTargets{ 
        piece: letter, 
        rotation: zero, 
        shape: piece_shape,
        row: zero,
        col: builder.select(is_one,fourteen, thirteen),
    };

    let no_collisions = board.no_collision(builder, piece_shape, piece_state.row, piece_state.col).target;
    let game_okay = builder.select(both_null, one, no_collisions);
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
    fn default(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> Self {
        Self {
            shapes: construct_shapes(builder),
            kicks: construct_kicks(builder),
            combo: construct_combo(builder),
            geq: construct_geq(builder),
        }
    }
}

fn construct_geq(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> usize {
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

fn construct_combo(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> usize {
    let mut input  = Vec::new();
    let mut output = Vec::new();
    for index in 0..25 {
        input.push(index as u16);
        output.push(COMBO_TABLE[index] as u16);
    }
    builder.add_lookup_table_from_table(&input, &output)
}

fn construct_kicks(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> usize {
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

fn construct_shapes(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> usize {
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
    builder: &mut CircuitBuilder<GoldilocksField, 2>, 
    piece: Target, 
    rotation: Target, 
    table: usize
) -> [[Target;2];4] {
    let zero = builder.zero();
    let eight = builder.constant(GoldilocksField::from_canonical_usize(8));
    let thirty_two = builder.constant(GoldilocksField::from_canonical_usize(32));  
    let mut coords = [[zero;2];4];

    let piece_index = builder.mul(piece, thirty_two);
    let pr_index = builder.mul_add(rotation, eight, piece_index);

    for block in 0..4 {
        for axis in 0..2 {
            let ba_index = block * 2 + axis;
            let ba_t = builder.constant(GoldilocksField::from_canonical_usize(ba_index));
            let index_t = builder.add(ba_t, pr_index);

            coords[block][axis] = builder.add_lookup_from_index(index_t, table);
        }
    }
    coords
}




fn col_to_mask(
    builder: &mut CircuitBuilder<GoldilocksField, 2>,
    col: Target,
) -> Target {
    let mut mask = builder.zero();
    for i in 10..20 {
        let shifted_index = i - 10;
        let i_target = builder.constant(GoldilocksField::from_canonical_u32(i));
        let is_col = builder.is_equal(col, i_target);
        let bit_value = builder.constant(GoldilocksField::from_canonical_u32(1 << shifted_index));
        let term = builder.mul(is_col.target, bit_value);
        mask = builder.add(mask, term);
    }
    mask
}


fn select_piece_state(
    builder: &mut CircuitBuilder<GoldilocksField, 2>,
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
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
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
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
        action: Target, // left right cw ccw sd hold
        tables: Tables
    ) -> Self{
        let zero = builder.zero();
        let one = builder.one();
        let two = builder.constant(GoldilocksField::from_canonical_usize(2));
        let three = builder.constant(GoldilocksField::from_canonical_usize(3));
        let four = builder.constant(GoldilocksField::from_canonical_usize(4));
        let five = builder.constant(GoldilocksField::from_canonical_usize(5));

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


    fn lock_piece(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>, combo_table: usize, geq_table: usize) -> GameState {
        let board = self.board;
        let (adjusted_piece, droppable) = self.current_piece.hard_drop(builder, board);
        let not_droppable = builder.not(droppable);
        let last_action_rotate = builder.and(self.last_action_was_rotation, not_droppable);
        let old_ledger = self.ledger.ledger;
        let three_corners = adjusted_piece.three_corners(builder, board);
        let is_tspin = builder.and(three_corners, last_action_rotate);
        let twenty_six = builder.constant(GoldilocksField::from_canonical_usize(26));
        let seven = builder.constant(GoldilocksField::from_canonical_usize(7));

        let placed_board = board.place(builder, adjusted_piece);
        let (cleared_board, lines_cleared) = placed_board.clear_lines(builder);

        let mut attack = builder.zero();
        let mut is = [builder._false(); 5];
        let mut is_ts = [builder._false(); 5];
        for i in 0..5 {
            let clear_constant = builder.constant(GoldilocksField::from_canonical_usize(i));
            is[i] = builder.is_equal(clear_constant, lines_cleared);
            is_ts[i] = builder.and(is_tspin, is[i]);
            attack = builder.mul_const_add(GoldilocksField::from_canonical_usize(ATTACK_TABLE[i]), is[i].target, attack);
            attack = builder.mul_const_add(GoldilocksField::from_canonical_usize(TSPIN_REWARD[i]), is_ts[i].target, attack);
        }

        let keep_b2b = builder.or(is[4], is_tspin);
        attack = builder.mul_add(keep_b2b.target, old_ledger[9], attack);

        let is_pc = cleared_board.check_empty(builder);
        let ten = builder.constant(GoldilocksField::from_canonical_usize(10));
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
                keep_b2b.target
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
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
        shape_table: usize 
    ) -> (PieceStateTargets, Target) {
        let zero = builder.zero();
        let one = builder.one();
        let thirteen = builder.constant(GoldilocksField(13));
        let fourteen = builder.constant(GoldilocksField(14));
        let null_target = builder.constant(GoldilocksField::from_canonical_usize(7));
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

    fn out_of_bounds(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>, row: Target, col: Target) -> BoolTarget {
        let zero = builder.zero();
        let eight = builder.constant(GoldilocksField::from_canonical_usize(8));
        let nine = builder.constant(GoldilocksField::from_canonical_usize(9));
        let twenty = builder.constant(GoldilocksField::from_canonical_usize(20));
        let twenty_one = builder.constant(GoldilocksField::from_canonical_usize(21));
        let twenty_two = builder.constant(GoldilocksField::from_canonical_usize(22));
        let add_one = builder.add_const(row, GoldilocksField::ONE);
        let add_two = builder.add_const(row, GoldilocksField::TWO);

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

    fn block_collision(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>, row: Target, col: Target) -> BoolTarget {
        let cells = self.cells;
        let ten = builder.constant(GoldilocksField::from_canonical_usize(10));

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

    fn no_collision(&self, builder:&mut CircuitBuilder<GoldilocksField, 2>, shape: [[Target;2];4], row: Target, col: Target) -> BoolTarget {
        let mut any_collision = builder._false();

        for block in 0..4 {
            let piece_row = builder.add(row,shape[block][1]); // these are flipped because 
            let piece_col = builder.add(col,shape[block][0]); // in the table they're x and y

            let collision = self.block_collision(builder, piece_row, piece_col);
            any_collision = builder.or(any_collision, collision);
        }
        builder.not(any_collision)
    }

    fn place(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>, piece_state: PieceStateTargets) -> BoardTargets {
        let mut cells = self.cells;
        let shape = piece_state.shape;
        for block in 0..4 {
            let piece_row = builder.add(piece_state.row,shape[block][1]);
            let piece_col = builder.add(piece_state.col,shape[block][0]);
            let col_mask = col_to_mask(builder, piece_col);

            for board_row in 0..21 {
                let board_target = builder.constant(GoldilocksField::from_canonical_usize(board_row));
                let is_row = builder.is_equal(board_target, piece_row);
                let contribution = builder.mul(is_row.target, col_mask);
                cells[board_row] = builder.add( contribution, cells[board_row]);
            }
        }
        BoardTargets { cells }
    }

    fn full_lines_under(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>) -> ([Target; 21], [BoolTarget; 21]) {
        let cells = self.cells;
        let mut counter = [builder.zero(); 21];
        let mut full_counter = [builder._false(); 21];
        let full_example = builder.constant(GoldilocksField::from_canonical_u16(1023));
        for board_row in (1..21).rev(){
            let full_row = builder.is_equal(full_example, cells[board_row]);
            full_counter[board_row] = full_row;
            counter[board_row - 1] = builder.add(counter[board_row], full_row.target);
        }
        (counter, full_counter)
    }


    fn clear_lines(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>) -> (BoardTargets, Target)  {
        let old_board = self.cells;
        let mut new_board = [builder.zero(); 21];

        let (cumulative, full_vec) = self.full_lines_under(builder);

        for new_row in (0..21).rev() {
            let new_t = builder.constant(GoldilocksField::from_canonical_usize(new_row));
            for shift in 0..5 {
                if shift > new_row { break; }
                let old_row = new_row - shift; 
                let old_t = builder.constant(GoldilocksField::from_canonical_usize(old_row));
                let dest = builder.add(old_t, cumulative[old_row]);
                let is_dest = builder.is_equal(dest, new_t);
                let not_full = builder.not(full_vec[old_row]);
                let write_this = builder.and(is_dest, not_full);
                new_board[new_row] = builder.select(write_this, old_board[old_row], new_board[new_row]);
            }
        }
        (BoardTargets{ cells: new_board }, cumulative[0])
    }

    fn check_empty(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>) -> BoolTarget {
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
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
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

    fn soft_drop(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>, board: BoardTargets) -> (PieceStateTargets, BoolTarget) {
        let one = builder.constant(GoldilocksField::from_canonical_usize(1));
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

    fn hard_drop(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>, board: BoardTargets) -> (PieceStateTargets, BoolTarget) {
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
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
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
        let two = builder.constant(GoldilocksField::from_canonical_usize(2));
        let four = builder.constant(GoldilocksField::from_canonical_usize(4));
        let five = builder.constant(GoldilocksField::from_canonical_usize(5));
        let ten = builder.constant(GoldilocksField::from_canonical_usize(10));
        let eighty = builder.constant(GoldilocksField::from_canonical_usize(80));

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
            let kick_t = builder.constant(GoldilocksField::from_canonical_usize(kick));
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

    fn three_corners(&self, builder:&mut CircuitBuilder<GoldilocksField, 2>, board: BoardTargets) -> BoolTarget {
        let mut num_collisions = builder.zero();
        let row = self.row;
        let col = self.col;
        
        let zero = builder.zero();
        let two = builder.constant(GoldilocksField::from_canonical_usize(2));
        let three = builder.constant(GoldilocksField::from_canonical_usize(3));
        let four = builder.constant(GoldilocksField::from_canonical_usize(4));

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
    fn empty(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> Self{
        LedgerTargets{ ledger: [builder.zero(); 10] }
    }
}