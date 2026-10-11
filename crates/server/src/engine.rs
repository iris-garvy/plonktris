//! Plonktris game rules — a line-for-line port of `frontend/src/game/engine.ts`.
//!
//! The TypeScript file is the source of truth: the client plays with it and records the solve as
//! a flat list of action bytes, and the server replays those bytes through this port to verify
//! them. ANY rule change there must be mirrored here. `shared/engine-fixtures.json` is generated
//! from the TS engine (`node shared/gen-fixtures.ts`) and replayed by the test at the bottom of
//! this file, so the two can't silently drift.
//!
//! Naming follows the TS file (snake_case). Where TS returns the *same object* for an
//! ineffective action, this port returns `None`.

// A full port of engine.ts: not every helper is used by the server itself.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// board + pieces
// ---------------------------------------------------------------------------

pub const COLS: usize = 10;
/// 21 rows: row 0 is the spawn buffer above the visible field, rows 1-20 are visible.
pub const ROWS: usize = 21;
pub const HIDDEN_ROWS: usize = 1;

pub const EMPTY: u8 = 0;
pub const GARBAGE: u8 = 8;

/// A board cell: 0 = empty, 1-7 = piece colour, 8 = garbage. Row 0 = top.
pub type Board = [[u8; COLS]; ROWS];

/// Piece ids (client side): 1 I, 2 O, 3 T, 4 S, 5 Z, 6 L, 7 J. The API uses id - 1 (0-6).
pub const I: u8 = 1;
pub const O: u8 = 2;
pub const T: u8 = 3;
pub const S: u8 = 4;
pub const Z: u8 = 5;
pub const L: u8 = 6;
pub const J: u8 = 7;
pub const PIECE_IDS: [u8; 7] = [I, O, T, S, Z, L, J];

type Offsets = [(i32, i32); 4];

/// [piece - 1][rotation] → four (x, y) offsets inside the piece's bounding box (SRS orientation).
pub const SHAPES: [[Offsets; 4]; 7] = [
    // I
    [
        [(0, 1), (1, 1), (2, 1), (3, 1)],
        [(2, 0), (2, 1), (2, 2), (2, 3)],
        [(0, 2), (1, 2), (2, 2), (3, 2)],
        [(1, 0), (1, 1), (1, 2), (1, 3)],
    ],
    // O
    [
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (0, 1), (1, 1)],
    ],
    // T
    [
        [(1, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (1, 1), (2, 1), (1, 2)],
        [(0, 1), (1, 1), (2, 1), (1, 2)],
        [(1, 0), (0, 1), (1, 1), (1, 2)],
    ],
    // S
    [
        [(1, 0), (2, 0), (0, 1), (1, 1)],
        [(1, 0), (1, 1), (2, 1), (2, 2)],
        [(1, 1), (2, 1), (0, 2), (1, 2)],
        [(0, 0), (0, 1), (1, 1), (1, 2)],
    ],
    // Z
    [
        [(0, 0), (1, 0), (1, 1), (2, 1)],
        [(2, 0), (1, 1), (2, 1), (1, 2)],
        [(0, 1), (1, 1), (1, 2), (2, 2)],
        [(1, 0), (0, 1), (1, 1), (0, 2)],
    ],
    // L
    [
        [(2, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (1, 1), (1, 2), (2, 2)],
        [(0, 1), (1, 1), (2, 1), (0, 2)],
        [(0, 0), (1, 0), (1, 1), (1, 2)],
    ],
    // J
    [
        [(0, 0), (0, 1), (1, 1), (2, 1)],
        [(1, 0), (2, 0), (1, 1), (1, 2)],
        [(0, 1), (1, 1), (2, 1), (2, 2)],
        [(1, 0), (1, 1), (0, 2), (1, 2)],
    ],
];

fn shape(piece: u8, rot: u8) -> &'static Offsets {
    &SHAPES[(piece - 1) as usize][(rot & 3) as usize]
}

/// SRS wall kicks, [kind (0 = JLSTZ, 1 = I)][from_rotation * 2 + (cw ? 1 : 0)][test] → (dx, dy).
/// dy is "up" (guideline convention), so a kick moves the piece to row - dy.
pub const SRS_KICKS: [[[(i32, i32); 5]; 8]; 2] = [
    [
        [(0, 0), (1, 0), (1, 1), (0, -2), (1, -2)],
        [(0, 0), (-1, 0), (-1, 1), (0, -2), (-1, -2)],
        [(0, 0), (1, 0), (1, -1), (0, 2), (1, 2)],
        [(0, 0), (1, 0), (1, -1), (0, 2), (1, 2)],
        [(0, 0), (-1, 0), (-1, 1), (0, -2), (-1, -2)],
        [(0, 0), (1, 0), (1, 1), (0, -2), (1, -2)],
        [(0, 0), (-1, 0), (-1, -1), (0, 2), (-1, 2)],
        [(0, 0), (-1, 0), (-1, -1), (0, 2), (-1, 2)],
    ],
    [
        [(0, 0), (-1, 0), (2, 0), (-1, 2), (2, -1)],
        [(0, 0), (-2, 0), (1, 0), (-2, -1), (1, 2)],
        [(0, 0), (2, 0), (-1, 0), (2, 1), (-1, -2)],
        [(0, 0), (-1, 0), (2, 0), (-1, 2), (2, -1)],
        [(0, 0), (1, 0), (-2, 0), (1, -2), (-2, 1)],
        [(0, 0), (2, 0), (-1, 0), (2, 1), (-1, -2)],
        [(0, 0), (-2, 0), (1, 0), (-2, -1), (1, 2)],
        [(0, 0), (1, 0), (-2, 0), (1, -2), (-2, 1)],
    ],
];

pub fn empty_board() -> Board {
    [[EMPTY; COLS]; ROWS]
}

/// Spawn column of the piece's bounding box: O spawns at 4, everything else at 3.
pub fn spawn_col(piece: u8) -> i32 {
    if piece == O { 4 } else { 3 }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellPos {
    pub row: i32,
    pub col: i32,
}

pub fn piece_cells(piece: u8, rot: u8, row: i32, col: i32) -> [CellPos; 4] {
    shape(piece, rot).map(|(dx, dy)| CellPos { row: row + dy, col: col + dx })
}

pub fn fits(board: &Board, piece: u8, rot: u8, row: i32, col: i32) -> bool {
    for &(dx, dy) in shape(piece, rot) {
        let (r, c) = (row + dy, col + dx);
        if r < 0 || r >= ROWS as i32 || c < 0 || c >= COLS as i32 {
            return false;
        }
        if board[r as usize][c as usize] != EMPTY {
            return false;
        }
    }
    true
}

/// Lowest row the piece can fall to from `row` without moving sideways.
pub fn drop_row(board: &Board, piece: u8, rot: u8, row: i32, col: i32) -> i32 {
    let mut r = row;
    while fits(board, piece, rot, r + 1, col) {
        r += 1;
    }
    r
}

/// Removes full rows, shifting everything above down. Returns the new board and lines cleared.
pub fn clear_lines(board: &Board) -> (Board, u32) {
    let kept: Vec<&[u8; COLS]> = board.iter().filter(|row| row.contains(&EMPTY)).collect();
    let lines = ROWS - kept.len();
    if lines == 0 {
        return (*board, 0);
    }
    let mut out = empty_board();
    for (i, row) in kept.into_iter().enumerate() {
        out[lines + i] = *row;
    }
    (out, lines as u32)
}

/// A valid puzzle board: no full rows, nothing in the hidden spawn row.
pub fn valid_puzzle_board(board: &Board) -> bool {
    if board[0].iter().any(|&c| c != EMPTY) {
        return false;
    }
    board.iter().all(|r| r.contains(&EMPTY))
}

// ---------------------------------------------------------------------------
// actions — also the solution wire format (one byte per action)
// ---------------------------------------------------------------------------

pub mod action {
    pub const LEFT: u8 = 0;
    pub const RIGHT: u8 = 1;
    pub const CW: u8 = 2;
    pub const CCW: u8 = 3;
    /// move down one row
    pub const SOFT: u8 = 4;
    pub const HOLD: u8 = 5;
    /// hard drop + lock
    pub const HARD: u8 = 6;
    pub const ROT180: u8 = 7;
}
pub const NUM_ACTIONS: u8 = 8;

// ---------------------------------------------------------------------------
// ledger (what a solve achieved) + requirements
// ---------------------------------------------------------------------------

pub const ATTACK_TABLE: [u32; 5] = [0, 0, 1, 2, 4];
pub const TSPIN_REWARD: [u32; 5] = [0, 2, 3, 4, 0];
pub const COMBO_TABLE: [u32; 25] = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
pub const PC_BONUS: u32 = 10;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    pub tss: u32,
    pub tsd: u32,
    pub tst: u32,
    pub tetris: u32,
    pub pc: u32,
    pub attack: u32,
    pub max_combo: u32,
    /// current combo: consecutive line-clearing pieces
    pub combo: u32,
    /// 1 while a back-to-back chain is live
    pub b2b: u32,
    pub lines: u32,
}

pub fn empty_ledger() -> Ledger {
    Ledger::default()
}

pub const REQUIREMENT_NAMES: [&str; 8] = ["TSS", "TSD", "TST", "TETRIS", "PC", "ATTACK", "COMBO", "NO HOLD"];

pub fn ledger_counts(ledger: &Ledger) -> [u32; 7] {
    [ledger.tss, ledger.tsd, ledger.tst, ledger.tetris, ledger.pc, ledger.attack, ledger.max_combo]
}

/// Whether the ledger satisfies the 7 counted requirements (`requirements` is the API's 8-byte
/// [tss, tsd, tst, tetris, pc, attack, max_combo, no_hold] format). NO HOLD is enforced by the
/// engine.
pub fn requirements_met(ledger: &Ledger, requirements: &[u8]) -> bool {
    let counts = ledger_counts(ledger);
    (0..7).all(|i| counts[i] >= requirements.get(i).copied().unwrap_or(0) as u32)
}

/// What the most recent lock did — for HUD call-outs ("T-SPIN DOUBLE", "B2B", "COMBO 3").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LockEvent {
    pub piece: u8,
    pub lines: u32,
    pub tspin: bool,
    /// this clear continued a back-to-back chain (and got the +1)
    pub b2b: bool,
    /// combo count after this lock (0 = no clear)
    pub combo: u32,
    pub pc: bool,
    pub attack: u32,
}

// ---------------------------------------------------------------------------
// game state
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActivePiece {
    pub piece: u8,
    pub rot: u8,
    pub row: i32,
    pub col: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Playing,
    Done,
    Topout,
}

#[derive(Clone, Debug)]
pub struct GameState<'q> {
    pub board: Board,
    /// client piece ids (1-7)
    pub queue: &'q [u8],
    /// index of the next undrawn queue piece
    pub next: usize,
    pub active: Option<ActivePiece>,
    pub hold: Option<u8>,
    /// hold already used by the current piece (once per piece)
    pub hold_used: bool,
    /// hold disabled entirely (the puzzle's NO HOLD requirement)
    pub no_hold: bool,
    /// last effective action was a rotation — needed for T-spin detection
    pub last_rotate: bool,
    pub placed: usize,
    pub ledger: Ledger,
    pub status: Status,
    pub last_lock: Option<LockEvent>,
}

fn spawn_piece(mut s: GameState<'_>, piece: u8) -> GameState<'_> {
    let col = spawn_col(piece);
    if !fits(&s.board, piece, 0, 0, col) {
        s.active = None;
        s.status = Status::Topout;
        return s;
    }
    s.active = Some(ActivePiece { piece, rot: 0, row: 0, col });
    s.last_rotate = false;
    s
}

/// `queue` holds client piece ids (1-7).
pub fn new_game<'q>(board: &Board, queue: &'q [u8], no_hold: bool) -> GameState<'q> {
    let s = GameState {
        board: *board,
        queue,
        next: 0,
        active: None,
        hold: None,
        hold_used: false,
        no_hold,
        last_rotate: false,
        placed: 0,
        ledger: empty_ledger(),
        status: if queue.is_empty() { Status::Done } else { Status::Playing },
        last_lock: None,
    };
    if queue.is_empty() {
        return s;
    }
    spawn_piece(GameState { next: 1, ..s }, queue[0])
}

/// Whether HOLD would do anything right now.
pub fn can_hold(s: &GameState) -> bool {
    s.status == Status::Playing
        && s.active.is_some()
        && !s.no_hold
        && !s.hold_used
        && (s.hold.is_some() || s.next < s.queue.len())
}

fn tspin_corners(board: &Board, row: i32, col: i32) -> bool {
    let mut n = 0;
    for (dx, dy) in [(0, 0), (2, 0), (0, 2), (2, 2)] {
        let (r, c) = (row + dy, col + dx);
        if r < 0 || r >= ROWS as i32 || c < 0 || c >= COLS as i32 || board[r as usize][c as usize] != EMPTY {
            n += 1;
        }
    }
    n >= 3
}

fn lock<'q>(s: &GameState<'q>, a: ActivePiece) -> GameState<'q> {
    let land_row = drop_row(&s.board, a.piece, a.rot, a.row, a.col);
    // a spin only counts if the rotation was the last thing that moved the piece:
    // a hard drop that actually falls cancels it
    let spin = s.last_rotate && land_row == a.row;
    let tspin = a.piece == T && spin && tspin_corners(&s.board, land_row, a.col);

    let mut placed_board = s.board;
    for CellPos { row, col } in piece_cells(a.piece, a.rot, land_row, a.col) {
        placed_board[row as usize][col as usize] = a.piece;
    }
    let (board, raw_lines) = clear_lines(&placed_board);
    let lines = raw_lines.min(4);

    let old = s.ledger;
    let mut attack = ATTACK_TABLE[lines as usize];
    if tspin {
        attack += TSPIN_REWARD[lines as usize];
    }
    let keep_b2b = lines == 4 || (tspin && lines > 0);
    let b2b_bonus = keep_b2b && old.b2b > 0;
    if b2b_bonus {
        attack += old.b2b;
    }
    let pc = board.iter().all(|r| r.iter().all(|&c| c == EMPTY));
    if pc {
        attack += PC_BONUS;
    }
    let cleared = lines > 0;
    if cleared {
        attack += COMBO_TABLE[(old.combo as usize).min(COMBO_TABLE.len() - 1)];
    }
    let combo = if cleared { old.combo + 1 } else { 0 };

    let ledger = Ledger {
        tss: old.tss + u32::from(tspin && lines == 1),
        tsd: old.tsd + u32::from(tspin && lines == 2),
        tst: old.tst + u32::from(tspin && lines == 3),
        tetris: old.tetris + u32::from(lines == 4),
        pc: old.pc + u32::from(pc),
        attack: old.attack + attack,
        max_combo: old.max_combo.max(combo),
        combo,
        // only a line clear touches b2b: tetris / t-spin clears keep it, other clears break it
        b2b: if cleared { u32::from(keep_b2b) } else { old.b2b },
        lines: old.lines + raw_lines,
    };

    let after = GameState {
        board,
        active: None,
        hold_used: false,
        last_rotate: false,
        placed: s.placed + 1,
        ledger,
        last_lock: Some(LockEvent { piece: a.piece, lines, tspin, b2b: b2b_bonus, combo, pc, attack }),
        ..s.clone()
    };

    if after.placed >= s.queue.len() {
        return GameState { status: Status::Done, ..after };
    }
    if after.next < s.queue.len() {
        let piece = s.queue[after.next];
        return spawn_piece(GameState { next: after.next + 1, ..after }, piece);
    }
    // queue exhausted: the held piece comes out. (Always Some here: every drawn piece is either
    // placed or held, and fewer than queue.len() have been placed.)
    let held = after.hold.expect("queue exhausted with nothing held");
    spawn_piece(GameState { hold: None, ..after }, held)
}

fn try_move<'q>(s: &GameState<'q>, a: ActivePiece, drow: i32, dcol: i32) -> Option<GameState<'q>> {
    if !fits(&s.board, a.piece, a.rot, a.row + drow, a.col + dcol) {
        return None;
    }
    Some(GameState {
        active: Some(ActivePiece { row: a.row + drow, col: a.col + dcol, ..a }),
        last_rotate: false,
        ..s.clone()
    })
}

fn try_rotate<'q>(s: &GameState<'q>, a: ActivePiece, turn: u8) -> Option<GameState<'q>> {
    if a.piece == O {
        return None;
    }
    let rot = (a.rot + turn) & 3;
    // 180s have no kick table: in place or not at all
    let kicks: &[(i32, i32)] = if turn == 2 {
        &[(0, 0)]
    } else {
        &SRS_KICKS[if a.piece == I { 1 } else { 0 }][a.rot as usize * 2 + if turn == 1 { 1 } else { 0 }]
    };
    for &(dx, dy) in kicks {
        let (row, col) = (a.row - dy, a.col + dx);
        if fits(&s.board, a.piece, rot, row, col) {
            return Some(GameState {
                active: Some(ActivePiece { rot, row, col, ..a }),
                last_rotate: true,
                ..s.clone()
            });
        }
    }
    None
}

fn do_hold<'q>(s: &GameState<'q>, a: ActivePiece) -> Option<GameState<'q>> {
    if !can_hold(s) {
        return None;
    }
    match s.hold {
        None => {
            let piece = s.queue[s.next];
            Some(spawn_piece(GameState { hold: Some(a.piece), hold_used: true, next: s.next + 1, ..s.clone() }, piece))
        }
        Some(held) => Some(spawn_piece(GameState { hold: Some(a.piece), hold_used: true, ..s.clone() }, held)),
    }
}

/// Applies one action. Returns `None` when the action has no effect (blocked move, failed
/// rotation, hold not allowed, game over) — the TS engine returns the same object in that case.
/// Ineffective actions never change any state, including the spin flag.
pub fn step<'q>(s: &GameState<'q>, act: u8) -> Option<GameState<'q>> {
    let a = s.active?;
    if s.status != Status::Playing {
        return None;
    }
    match act {
        action::LEFT => try_move(s, a, 0, -1),
        action::RIGHT => try_move(s, a, 0, 1),
        action::SOFT => try_move(s, a, 1, 0),
        action::CW => try_rotate(s, a, 1),
        action::CCW => try_rotate(s, a, 3),
        action::ROT180 => try_rotate(s, a, 2),
        action::HOLD => do_hold(s, a),
        action::HARD => Some(lock(s, a)),
        _ => None,
    }
}

/// Row the active piece would land on (for the ghost).
pub fn ghost_row(s: &GameState) -> Option<i32> {
    s.active.map(|a| drop_row(&s.board, a.piece, a.rot, a.row, a.col))
}

// ---------------------------------------------------------------------------
// replay — exactly what the server does with a submitted solution
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReplayError {
    /// a byte outside 0-7
    BadAction,
    /// a piece couldn't spawn
    Topout,
    /// actions ran out before every piece was placed
    Incomplete,
    /// actions left over after the last piece locked
    Trailing,
    /// all pieces placed, requirements not met
    Requirements,
}

impl ReplayError {
    /// The TS engine's `ReplayError` string.
    pub fn code(self) -> &'static str {
        match self {
            ReplayError::BadAction => "bad_action",
            ReplayError::Topout => "topout",
            ReplayError::Incomplete => "incomplete",
            ReplayError::Trailing => "trailing",
            ReplayError::Requirements => "requirements",
        }
    }

    /// Human-readable reason, used in the API's 400 body.
    pub fn message(self) -> &'static str {
        match self {
            ReplayError::BadAction => "invalid action",
            ReplayError::Topout => "topped out",
            ReplayError::Incomplete => "not every piece was placed",
            ReplayError::Trailing => "moves after the last piece",
            ReplayError::Requirements => "requirements not met",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReplayResult {
    pub ok: bool,
    pub error: Option<ReplayError>,
    pub ledger: Ledger,
    pub placed: usize,
}

/// Replays `solution` on a puzzle. `queue` holds client ids (1-7); `requirements` is the 8-byte
/// format. Ineffective actions are skipped (they're no-ops), matching `step`.
pub fn replay(board: &Board, queue: &[u8], requirements: &[u8], solution: &[u8]) -> ReplayResult {
    replay_with_state(board, queue, requirements, solution).0
}

/// `replay`, also returning the state it stopped in (the fixtures check the final board too).
pub fn replay_with_state<'q>(
    board: &Board, queue: &'q [u8], requirements: &[u8], solution: &[u8],
) -> (ReplayResult, GameState<'q>) {
    let fail = |error, s: GameState<'q>| {
        (ReplayResult { ok: false, error: Some(error), ledger: s.ledger, placed: s.placed }, s)
    };
    let no_hold = requirements.get(7).is_some_and(|&b| b != 0);
    let mut s = new_game(board, queue, no_hold);
    for &act in solution {
        if act >= NUM_ACTIONS {
            return fail(ReplayError::BadAction, s);
        }
        if s.status == Status::Done {
            return fail(ReplayError::Trailing, s);
        }
        if let Some(next) = step(&s, act) {
            s = next;
        }
        if s.status == Status::Topout {
            return fail(ReplayError::Topout, s);
        }
    }
    if s.status != Status::Done {
        return fail(ReplayError::Incomplete, s);
    }
    if !requirements_met(&s.ledger, requirements) {
        return fail(ReplayError::Requirements, s);
    }
    (ReplayResult { ok: true, error: None, ledger: s.ledger, placed: s.placed }, s)
}

// ---------------------------------------------------------------------------
// API format conversions
// ---------------------------------------------------------------------------

/// 210 occupancy bits (row-major, row 0 = top) → board with garbage cells.
pub fn board_from_bits(bits: &[u8]) -> Board {
    let mut board = empty_board();
    for (r, row) in board.iter_mut().enumerate() {
        for (c, cell) in row.iter_mut().enumerate() {
            if bits.get(r * COLS + c).is_some_and(|&b| b != 0) {
                *cell = GARBAGE;
            }
        }
    }
    board
}

pub fn board_to_bits(board: &Board) -> Vec<u8> {
    board.iter().flatten().map(|&c| u8::from(c != EMPTY)).collect()
}

/// API piece ids (0-6) ↔ client ids (1-7).
pub fn queue_from_api(q: &[u8]) -> Vec<u8> {
    q.iter().map(|&id| id + 1).collect()
}

pub fn queue_to_api(q: &[u8]) -> Vec<u8> {
    q.iter().map(|&id| id - 1).collect()
}

/// Replays a solution against a puzzle in API formats (board bits, queue ids 0-6, 8-byte
/// requirements). The caller must have checked the queue ids are 0-6.
pub fn replay_api(board_bits: &[u8], queue_api: &[u8], requirements: &[u8], solution: &[u8]) -> ReplayResult {
    let queue = queue_from_api(queue_api);
    replay(&board_from_bits(board_bits), &queue, requirements, solution)
}

#[cfg(test)]
mod tests {
    use super::action::*;
    use super::*;

    /// One case of `shared/engine-fixtures.json` (inputs in API format, outputs from engine.ts).
    #[derive(Deserialize)]
    struct Case {
        name: String,
        board: Vec<u8>,
        queue: Vec<u8>,
        requirements: Vec<u8>,
        solution: Vec<u8>,
        expected: Expected,
    }

    #[derive(Deserialize, Debug, PartialEq)]
    struct Expected {
        ok: bool,
        error: Option<String>,
        ledger: Ledger,
        placed: usize,
        /// the 210 cells (0-8, row-major) of the board replay stopped on
        final_board: Vec<u8>,
    }

    #[derive(Deserialize)]
    struct Fixtures {
        cases: Vec<Case>,
    }

    fn render(cells: &[u8]) -> String {
        cells
            .chunks(COLS)
            .enumerate()
            .map(|(r, row)| {
                let s: String = row.iter().map(|&c| if c == 0 { '.' } else { char::from(b'0' + c) }).collect();
                format!("      {r:>2} {s}")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn diff(case: &Case, got: &Expected) -> String {
        let want = &case.expected;
        let mut out = format!("  case {:?}:", case.name);
        if got.ok != want.ok {
            out += &format!("\n    ok: TS {} / Rust {}", want.ok, got.ok);
        }
        if got.error != want.error {
            out += &format!("\n    error: TS {:?} / Rust {:?}", want.error, got.error);
        }
        if got.ledger != want.ledger {
            out += &format!("\n    ledger: TS {:?}\n          Rust {:?}", want.ledger, got.ledger);
        }
        if got.placed != want.placed {
            out += &format!("\n    placed: TS {} / Rust {}", want.placed, got.placed);
        }
        if got.final_board != want.final_board {
            out += &format!(
                "\n    final board differs:\n    TS:\n{}\n    Rust:\n{}",
                render(&want.final_board),
                render(&got.final_board)
            );
        }
        out
    }

    /// The TS engine is the source of truth: every fixture it generated must replay identically.
    #[test]
    fn matches_ts_engine_fixtures() {
        let fixtures: Fixtures = serde_json::from_str(include_str!("../../../shared/engine-fixtures.json"))
            .expect("shared/engine-fixtures.json is malformed — regenerate it with `node shared/gen-fixtures.ts`");
        assert!(fixtures.cases.len() >= 100, "suspiciously few fixture cases: {}", fixtures.cases.len());

        let mut failures = Vec::new();
        for case in &fixtures.cases {
            let queue = queue_from_api(&case.queue);
            let board = board_from_bits(&case.board);
            let (res, state) = replay_with_state(&board, &queue, &case.requirements, &case.solution);
            let got = Expected {
                ok: res.ok,
                error: res.error.map(|e| e.code().to_string()),
                ledger: res.ledger,
                placed: res.placed,
                final_board: state.board.iter().flatten().copied().collect(),
            };
            if got != case.expected {
                failures.push(diff(case, &got));
            }
        }
        if !failures.is_empty() {
            panic!(
                "Rust engine disagrees with engine.ts on {} of {} fixture cases:\n{}",
                failures.len(),
                fixtures.cases.len(),
                failures.join("\n")
            );
        }
    }

    // A few direct checks, independent of the fixtures.

    #[test]
    fn spawn_positions() {
        let q = [T, O, I];
        let s = new_game(&empty_board(), &q, false);
        assert_eq!(s.active, Some(ActivePiece { piece: T, rot: 0, row: 0, col: 3 }));
        let s = step(&s, HARD).unwrap();
        assert_eq!(s.active, Some(ActivePiece { piece: O, rot: 0, row: 0, col: 4 }));
    }

    #[test]
    fn ineffective_actions_return_none() {
        let q = [O];
        let s = new_game(&empty_board(), &q, false);
        assert!(step(&s, CW).is_none(), "O never rotates");
        assert!(step(&s, HOLD).is_none(), "nothing to swap in");
        let mut s = s;
        for _ in 0..4 {
            s = step(&s, LEFT).unwrap();
        }
        assert!(step(&s, LEFT).is_none(), "against the wall");
        assert!(step(&s, 8).is_none());
    }

    #[test]
    fn rotation_180_has_no_kicks() {
        // T resting on the floor: a 180 would poke below the board, and there are no kicks.
        let q = [T];
        let mut s = new_game(&empty_board(), &q, false);
        while let Some(n) = step(&s, SOFT) {
            s = n;
        }
        assert!(step(&s, ROT180).is_none());
        assert!(step(&s, CW).is_some(), "a normal rotation kicks up instead");
    }

    #[test]
    fn replay_error_precedence() {
        let q = [O];
        let reqs = [0u8; 8];
        let b = empty_board();
        assert_eq!(replay(&b, &q, &reqs, &[HARD]).error, None);
        assert_eq!(replay(&b, &q, &reqs, &[]).error, Some(ReplayError::Incomplete));
        assert_eq!(replay(&b, &q, &reqs, &[HARD, LEFT]).error, Some(ReplayError::Trailing));
        // a bad byte is reported even after the last piece
        assert_eq!(replay(&b, &q, &reqs, &[HARD, 9]).error, Some(ReplayError::BadAction));
        assert_eq!(replay(&b, &q, &[1, 0, 0, 0, 0, 0, 0, 0], &[HARD]).error, Some(ReplayError::Requirements));
    }

    #[test]
    fn bits_roundtrip() {
        let mut bits = vec![0u8; ROWS * COLS];
        bits[20 * COLS] = 1;
        bits[5 * COLS + 7] = 1;
        let board = board_from_bits(&bits);
        assert_eq!(board[20][0], GARBAGE);
        assert_eq!(board[5][7], GARBAGE);
        assert_eq!(board_to_bits(&board), bits);
        assert_eq!(queue_to_api(&queue_from_api(&[0, 6, 3])), vec![0, 6, 3]);
    }
}
