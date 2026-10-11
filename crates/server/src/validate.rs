//! Request validation for publishing / solving puzzles. Pure functions, so they're unit-tested
//! without a database. Error strings are returned to the client as the 400 body.

use crate::engine::{COLS, ROWS};

pub const MAX_QUEUE: usize = 30;
pub const MAX_SOLUTION: usize = 8192;
pub const MAX_NAME_CHARS: usize = 64;

/// A puzzle in API format: `board` = 210 occupancy bits (row 0 = hidden spawn row, must be
/// empty, no full rows), `queue` = 1-30 piece ids 0-6, `requirements` = 8 bytes
/// [tss, tsd, tst, tetris, pc, attack, max_combo, no_hold] with no_hold 0/1 and at least one
/// of the first seven set.
pub fn validate_puzzle(board: &[u8], queue: &[u8], requirements: &[u8]) -> Result<(), String> {
    if board.len() != ROWS * COLS {
        return Err(format!("board must have {} cells", ROWS * COLS));
    }
    if board.iter().any(|&b| b > 1) {
        return Err("board cells must be 0 or 1".into());
    }
    if board[..COLS].iter().any(|&b| b != 0) {
        return Err("the top (hidden) row of the board must be empty".into());
    }
    if board.chunks(COLS).any(|row| row.iter().all(|&b| b == 1)) {
        return Err("the board can't have full rows".into());
    }
    if queue.is_empty() || queue.len() > MAX_QUEUE {
        return Err(format!("queue must have 1-{MAX_QUEUE} pieces"));
    }
    if queue.iter().any(|&p| p > 6) {
        return Err("queue pieces must be 0-6".into());
    }
    if requirements.len() != 8 {
        return Err("requirements must be 8 bytes".into());
    }
    if requirements[7] > 1 {
        return Err("no_hold must be 0 or 1".into());
    }
    if requirements[..7].iter().all(|&r| r == 0) {
        return Err("must have requirements".into());
    }
    Ok(())
}

/// Just enough to replay safely: what a stored puzzle must satisfy so the engine can't panic.
/// (Puzzles from the ZK era were validated by their circuit, not by `validate_puzzle`.)
pub fn replayable(board: &[u8], queue: &[u8], requirements: &[u8]) -> bool {
    board.len() == ROWS * COLS && !queue.is_empty() && queue.iter().all(|&p| p <= 6) && requirements.len() == 8
}

pub fn validate_solution(solution: &[u8]) -> Result<(), String> {
    if solution.len() > MAX_SOLUTION {
        return Err(format!("solution is too long (max {MAX_SOLUTION} actions)"));
    }
    Ok(())
}

/// Puzzle name moderation: trimmed, blank → "untitled", at most 64 characters, no profanity.
pub fn clean_name(name: Option<&str>) -> Result<String, String> {
    let n = name.unwrap_or_default().trim();
    let n = if n.is_empty() { "untitled" } else { n };
    if n.chars().count() > MAX_NAME_CHARS {
        return Err(format!("name must be at most {MAX_NAME_CHARS} characters"));
    }
    if rustrict::CensorStr::is_inappropriate(n) {
        return Err("pick a different puzzle name".into());
    }
    Ok(n.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board() -> Vec<u8> {
        let mut b = vec![0u8; 210];
        // a little garbage in the bottom row, with a hole
        for c in 0..9 {
            b[200 + c] = 1;
        }
        b
    }
    const REQS: [u8; 8] = [1, 0, 0, 0, 0, 0, 0, 0];

    #[test]
    fn accepts_a_valid_puzzle() {
        assert_eq!(validate_puzzle(&board(), &[0, 1, 2, 3, 4, 5, 6], &REQS), Ok(()));
        assert_eq!(validate_puzzle(&vec![0; 210], &[2; 30], &[0, 0, 0, 0, 0, 0, 1, 1]), Ok(()));
    }

    #[test]
    fn board_checks() {
        assert!(validate_puzzle(&[0; 209], &[0], &REQS).unwrap_err().contains("210"));
        assert!(validate_puzzle(&[0; 211], &[0], &REQS).is_err());
        let mut b = board();
        b[150] = 2;
        assert_eq!(validate_puzzle(&b, &[0], &REQS).unwrap_err(), "board cells must be 0 or 1");
        let mut b = board();
        b[9] = 1;
        assert!(validate_puzzle(&b, &[0], &REQS).unwrap_err().contains("top (hidden) row"));
        let mut b = board();
        b[209] = 1;
        assert_eq!(validate_puzzle(&b, &[0], &REQS).unwrap_err(), "the board can't have full rows");
        // a full visible row anywhere, not just the bottom
        let mut b = vec![0u8; 210];
        b[10..20].fill(1);
        assert!(validate_puzzle(&b, &[0], &REQS).is_err());
    }

    #[test]
    fn queue_checks() {
        assert_eq!(validate_puzzle(&board(), &[], &REQS).unwrap_err(), "queue must have 1-30 pieces");
        assert!(validate_puzzle(&board(), &[0; 31], &REQS).is_err());
        assert_eq!(validate_puzzle(&board(), &[0, 7], &REQS).unwrap_err(), "queue pieces must be 0-6");
    }

    #[test]
    fn requirement_checks() {
        assert_eq!(validate_puzzle(&board(), &[0], &[1, 0, 0]).unwrap_err(), "requirements must be 8 bytes");
        assert_eq!(validate_puzzle(&board(), &[0], &[1, 0, 0, 0, 0, 0, 0, 2]).unwrap_err(), "no_hold must be 0 or 1");
        assert_eq!(validate_puzzle(&board(), &[0], &[0; 8]).unwrap_err(), "must have requirements");
        // NO HOLD alone isn't a requirement
        assert_eq!(validate_puzzle(&board(), &[0], &[0, 0, 0, 0, 0, 0, 0, 1]).unwrap_err(), "must have requirements");
    }

    #[test]
    fn solution_length() {
        assert!(validate_solution(&vec![6; MAX_SOLUTION]).is_ok());
        assert!(validate_solution(&vec![6; MAX_SOLUTION + 1]).is_err());
    }

    #[test]
    fn replayable_guards_the_engine() {
        assert!(replayable(&board(), &[6], &REQS));
        assert!(!replayable(&board(), &[7], &REQS));
        assert!(!replayable(&board(), &[], &REQS));
        assert!(!replayable(&[0; 10], &[0], &REQS));
        assert!(!replayable(&board(), &[0], &[1]));
    }

    #[test]
    fn names() {
        assert_eq!(clean_name(None).unwrap(), "untitled");
        assert_eq!(clean_name(Some("   ")).unwrap(), "untitled");
        assert_eq!(clean_name(Some("  tsd practice ")).unwrap(), "tsd practice");
        assert!(clean_name(Some(&"a".repeat(64))).is_ok());
        assert!(clean_name(Some(&"a".repeat(65))).is_err());
        // 64 multi-byte characters are fine: the limit is characters, not bytes
        assert!(clean_name(Some(&"é".repeat(64))).is_ok());
        assert_eq!(clean_name(Some("fuck")).unwrap_err(), "pick a different puzzle name");
    }
}
