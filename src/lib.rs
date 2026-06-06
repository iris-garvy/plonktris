use plonky2::field::types::{Field};
use plonky2::iop::target::{BoolTarget, Target};
use plonky2::iop::witness::{PartialWitness, WitnessWrite};
use plonky2::plonk::circuit_builder::{CircuitBuilder};
use plonky2::field::goldilocks_field::GoldilocksField;


use plonky2::plonk::circuit_data::CircuitConfig;
use wasm_bindgen::prelude::*;

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

fn verify_requirements(
    builder: &mut CircuitBuilder<GoldilocksField, 2>, 
    requirements: &[u8], 
    ledger: LedgerTargets
) {
    let mut target = [builder.zero(); 6];
    let mut difference = [builder.zero(); 6];
    for req in 0..6 {
        target[req] = builder.constant(GoldilocksField::from_canonical_u8(requirements[req]));
    }
    difference[0] = builder.sub(target[0], ledger.tss);
    difference[1] = builder.sub(target[1], ledger.tsd);
    difference[2] = builder.sub(target[2], ledger.tst);
    difference[3] = builder.sub(target[3], ledger.tetris);
    difference[4] = builder.sub(target[4], ledger.pc);
    difference[5] = builder.sub(target[1], ledger.attack);
    for req in 0..6 {
        builder.assert_zero(difference[req]);
    }
}

fn deserialize_board(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> [Target;210] {
    [builder.add_virtual_public_input();210]
}

fn bits_to_board(builder: &mut CircuitBuilder<GoldilocksField, 2>, bits: [Target;210]) -> Result<BoardTargets, String> {
    let mut cells = [builder.zero(); 21];
    let mut const_target;
    let mut column_mask= [builder.zero(); 10];

    for c in 0..10 {
        const_target = builder.constant(GoldilocksField::from_canonical_usize(c));
        column_mask[c] = col_to_mask(builder, const_target);
    }

    for row in 0..21 {
        for col in 0..10 {
            cells[row] = builder.mul_add(column_mask[col], bits[row*10+col], cells[row]);
        }
    }
    Ok(BoardTargets { cells: cells })
}

fn deserialize_queue(builder: &mut CircuitBuilder<GoldilocksField, 2>, queue_length: usize) -> Vec<Target> {
    let mut queue_targets = Vec::new();
    for _ in 0..queue_length {
        queue_targets.push(builder.add_virtual_public_input());
    }
    queue_targets
}

fn deserialize_actions(builder: &mut CircuitBuilder<GoldilocksField, 2>, queue_length: usize) -> Vec<Vec<Target>>{
    let mut action_targets = Vec::new();
    for piece in 0..queue_length{
        action_targets.push(Vec::new());
        for _ in 0..32 {
            action_targets[piece].push(builder.add_virtual_target());
        }
    }
    action_targets
}

fn assign_actions(
    builder: &mut CircuitBuilder<GoldilocksField, 2>, 
    num_pieces: usize, 
    actions: &[u8]
) -> Result<Vec<Vec<Target>>, String> {
    let mut action_list = Vec::new();
    let mut action_type = [builder.add_virtual_target(); 6];
    let mut piece_counter = 0;
    let mut action_counter = 0;

    for act in 0..6 {
        action_type[act] = builder.constant(GoldilocksField::from_canonical_usize(act));
    }
    while piece_counter < num_pieces {
        action_list.push(Vec::new());
        loop {
            if actions[action_counter] == 5 { break; }
            action_list[piece_counter].push(action_type[actions[action_counter] as usize]);
            action_counter += 1;
        }
        action_counter += 1;
        piece_counter += 1;
    }

    Ok(action_list)
}

fn simulate(
    builder: &mut CircuitBuilder<GoldilocksField, 2>, 
    board: BoardTargets, 
    queue: Vec<Target>, 
    actions: Vec<Vec<Target>>
) -> LedgerTargets {
    let mut queue_index = 0;
    let mut board = board;
    let mut ledger = LedgerTargets::empty(builder);
    let tables = Tables::default(builder);
    for piece_actions in &actions {
        let (piece, _) = PieceStateTargets::spawn(queue[queue_index], builder, board, tables.shapes);
        let mut game_state = GameState::new(builder, board, piece, ledger);
        for action in piece_actions {
            game_state = game_state.apply_movement(builder, *action, tables);
        }
        game_state = game_state.lock_piece(builder, tables.combo);
        board = game_state.board;
        ledger = game_state.ledger;
        queue_index += 1;
    }
    ledger
}

#[derive(Debug, Clone, Copy)]
struct Tables {
    shapes: usize,
    kicks: usize,
    combo: usize,
}

impl Tables {
    fn default(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> Self {
        Self {
            shapes: construct_shapes(builder),
            kicks: construct_kicks(builder),
            combo: construct_combo(builder),
        }
    }
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
    for p in 0..7{
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

#[derive(Debug, Clone, Copy)]
struct GameState {
    board: BoardTargets,
    current_piece: PieceStateTargets,
    last_action_was_rotation: BoolTarget,
    ledger: LedgerTargets,
}

impl GameState {
    fn new(
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
        board: BoardTargets, 
        piece: PieceStateTargets,
        ledger: LedgerTargets
    ) -> Self{
        GameState { 
            board: board,  
            current_piece: piece, 
            last_action_was_rotation: builder._false(), 
            ledger: ledger}
    }

    fn apply_movement(
        &self, 
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
        action: Target, // left right cw ccw sd
        tables: Tables
    ) -> Self{
        let current_piece = self.current_piece;
        let board = self.board;
        let mut last_action_rotate = self.last_action_was_rotation;

        let zero = builder.zero();
        let one = builder.one();
        let two = builder.constant(GoldilocksField::from_canonical_usize(2));
        let three = builder.constant(GoldilocksField::from_canonical_usize(3));
        let four = builder.constant(GoldilocksField::from_canonical_usize(4));

        let is_left = builder.is_equal(zero,action);
        let is_right = builder.is_equal(action, one);
        let is_shift = builder.or(is_left,is_right);
        let is_cw = builder.is_equal(action, two);
        let is_ccw = builder.is_equal(action, three);
        let is_rotate = builder.or(is_ccw, is_cw);
        let is_sd = builder.is_equal(action, four);

        let (shifted_piece, shift_ok) = current_piece.shift(builder, board, is_right);
        let (sd_piece,sd_ok) = current_piece.soft_drop(builder, board);
        let (rotated_piece, rotate_ok) = current_piece.rotate(builder, board, is_cw, tables);


        let shifted = builder.and(is_shift,shift_ok);
        let didnt_shift = builder.not(shifted);
        let rotated = builder.and(is_rotate, rotate_ok);
        let moved_sd = builder.and(is_sd, sd_ok);
        let didnt_sd = builder.not(moved_sd);

        last_action_rotate = builder.and(didnt_shift, last_action_rotate);
        last_action_rotate = builder.and(didnt_sd, last_action_rotate);
        last_action_rotate = builder.or(rotate_ok, last_action_rotate);

        let mut adjusted_piece = current_piece;
        adjusted_piece = select_piece_state(builder, is_shift, shifted_piece, adjusted_piece);
        adjusted_piece = select_piece_state(builder, rotated, rotated_piece, adjusted_piece);
        adjusted_piece = select_piece_state(builder, is_sd, sd_piece, adjusted_piece);


        GameState { 
            board: board, 
            current_piece: adjusted_piece, 
            last_action_was_rotation: last_action_rotate, 
            ledger: self.ledger
        }
    }


    fn lock_piece(&self, builder: &mut CircuitBuilder<GoldilocksField, 2>, combo_table: usize) -> GameState {
        let board = self.board;
        let (adjusted_piece, droppable) = self.current_piece.hard_drop(builder, board);
        let not_droppable = builder.not(droppable);
        let last_action_rotate = builder.and(self.last_action_was_rotation, not_droppable);
        let old_ledger = self.ledger;
        let three_corners = adjusted_piece.three_corners(builder, board);
        let is_tspin = builder.and(three_corners, last_action_rotate);

        let placed_board = board.place(builder, adjusted_piece);
        let (cleared_board, lines_cleared) = placed_board.clear_lines(builder);

        let mut attack = builder.zero();
        let mut clear_constant = builder.zero();
        let mut is = [builder._false(); 5];
        let mut is_ts = [builder._false(); 5];
        for i in 0..5 {
            clear_constant = builder.constant(GoldilocksField::from_canonical_usize(i));
            is[i] = builder.is_equal(clear_constant, lines_cleared);
            is_ts[i] = builder.and(is_tspin, is[i]);
            attack = builder.mul_const_add(GoldilocksField::from_canonical_usize(ATTACK_TABLE[i]), is[i].target, attack);
            attack = builder.mul_const_add(GoldilocksField::from_canonical_usize(TSPIN_REWARD[i]), is_ts[i].target, attack);
        }

        let keep_b2b = builder.or(is[4], is_tspin);
        attack = builder.mul_add(keep_b2b.target, old_ledger.b2b.target, attack);

        let is_pc = cleared_board.check_empty(builder);
        let ten = builder.constant(GoldilocksField::from_canonical_usize(10));
        attack = builder.mul_add(is_pc.target, ten, attack);
        
        let add_combo = builder.not(is[0]);
        let combo_attack = builder.add_lookup_from_index(old_ledger.combo, combo_table);
        attack = builder.mul_add(add_combo.target, combo_attack, attack);


        let new_ledger = LedgerTargets{
            tss: builder.add(old_ledger.tss, is_ts[1].target),
            tsd: builder.add(old_ledger.tsd, is_ts[2].target),
            tst: builder.add(old_ledger.tst, is_ts[3].target),
            tetris: builder.add(old_ledger.tetris, is[4].target),
            pc: builder.add(old_ledger.pc, is_pc.target),
            attack: builder.add(old_ledger.attack, attack),
            combo: builder.mul_add(old_ledger.combo, add_combo.target, add_combo.target),
            b2b: keep_b2b
        };

        GameState { 
            board: cleared_board, 
            current_piece: adjusted_piece, 
            last_action_was_rotation: builder._false(), 
            ledger: new_ledger 
        }
    }

}


#[derive(Debug, Clone, Copy)]
struct BoardTargets{
    cells: [Target; 21]
}

impl BoardTargets{

    fn empty(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> Self {
        Self { cells: [builder.zero();21] }
    }

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
        let zero = builder.zero();
        let fresh_row = builder.add(row, zero);
        let fresh_col = builder.add(col, zero);

        for block in 0..4 {
            let piece_row = builder.add(fresh_row,shape[block][1]); // these are flipped because 
            let piece_col = builder.add(fresh_col,shape[block][0]); // in the table they're x and y

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


const PIECE_SHAPE: [[[[u32; 2]; 4]; 4]; 7] = [
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

    fn spawn(
        letter: Target, 
        builder: &mut CircuitBuilder<GoldilocksField, 2>, 
        board: BoardTargets, 
        shape_table: usize
    ) -> (Self, BoolTarget) {

        let zero = builder.zero();
        let one = builder.one();
        // let seven = builder.constant(GoldilocksField::from_canonical_usize(7));
        // let is_seven = builder.is_equal(letter, seven);
        // builder.range_check(letter, 3);
        // builder.assert_zero(is_seven.target);

        let is_one = builder.is_equal(letter, one);
        let fourteen = builder.constant(GoldilocksField::from_canonical_usize(14));
        let thirteen = builder.constant(GoldilocksField::from_canonical_usize(13));

        let piece_shape = get_shape(builder, letter, zero, shape_table);
        let piece_state = PieceStateTargets{ 
            piece: letter, 
            rotation: zero, 
            shape: piece_shape,
            row: zero,
            col: builder.select(is_one,fourteen, thirteen)
        };

        let game_okay = board.no_collision(builder, piece_shape, piece_state.row, piece_state.col);

        (piece_state, game_okay)
    }

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
            col: builder.select(shiftable, new_col, self.col) 
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
                col: self.col
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
        (PieceStateTargets { piece: self.piece, rotation: final_rotation, shape: shape_coord, row: final_row, col: final_col }, found)
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
struct LedgerTargets{
    tss: Target,
    tsd: Target,
    tst: Target,
    tetris: Target,
    pc: Target,
    attack: Target,
    combo: Target,
    b2b: BoolTarget,
}

impl LedgerTargets{
    fn empty(builder: &mut CircuitBuilder<GoldilocksField, 2>) -> Self{
        Self { 
            tss: builder.zero(), 
            tsd: builder.zero(), 
            tst: builder.zero(), 
            tetris: builder.zero(), 
            pc: builder.zero(),
            attack: builder.zero(),
            combo: builder.zero(),
            b2b: builder._false(),
        }
    }
}




#[test]
fn test_simulate_one_o_piece_empty_board() {
    use plonky2::iop::witness::PartialWitness;
    use plonky2::plonk::circuit_builder::CircuitBuilder;
    use plonky2::plonk::circuit_data::CircuitConfig;
    use std::time::Instant;


    let config = CircuitConfig::standard_recursion_config();
    let mut builder = CircuitBuilder::<GoldilocksField, 2>::new(config);

    let board = BoardTargets::empty(&mut builder);
    let zero = builder.zero();
    let one = builder.one();
    let two = builder.constant(GoldilocksField::from_canonical_usize(2));
    let three = builder.constant(GoldilocksField::from_canonical_usize(3));
    let four = builder.constant(GoldilocksField::from_canonical_usize(4));
    let five = builder.constant(GoldilocksField::from_canonical_usize(5));
    let _six = builder.constant(GoldilocksField::from_canonical_usize(6));

    //i o t s z l j
    let i = zero;
    let o = one;
    let t = two;
    let s = three;
    let z = four;
    let l = five;

    let queue = vec![i, z, l, s, o, t,];

    // left right cw ccw sd
    let left = zero;
    let right = one;
    let cw = two;
    let sd = four;

    let mut tspin = vec![left, left, left, cw];
    for _ in 0..19 {
        tspin.push(sd);
    }
    tspin.push(cw);

    let actions: Vec<Vec<Target>> = vec![
        vec![],
        vec![],
        vec![cw, left, left, left, left],
        vec![cw, right, right],
        vec![right; 4],
        tspin,
    ];

    let ledger = simulate(&mut builder, board, queue, actions);

    builder.assert_zero(ledger.tss);
    builder.assert_one(ledger.tsd);
    builder.assert_zero(ledger.tst);
    builder.assert_zero(ledger.tetris);
    builder.assert_zero(ledger.pc);


    println!("Number of Gates: {:?} ", builder.num_gates());
    let pw = PartialWitness::new();

    let prove_start = Instant::now();

    let data = builder.build::<plonky2::plonk::config::PoseidonGoldilocksConfig>();
    let proof = match data.prove(pw) {
        Ok(proof) => proof,
        Err(e) => panic!("prove failed: {e:#?}"),
    };
    println!("Prove took: {:?}", prove_start.elapsed());

    data.verify(proof).unwrap();
}

