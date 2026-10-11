// Small display helpers shared by the app views (cards, play header, result cards, editor).
import type { MouseEvent } from 'react';
import {
  REQUIREMENT_NAMES, boardFromBits, ledgerCounts, queueFromApi,
  type Ledger, type Requirements,
} from './game/engine';
import type { Puzzle } from './api';
import type { PuzzleSpec } from './components/PuzzlePlayer';

export const MAX_QUEUE = 30;
export const MAX_NAME = 64;

/** Chip labels for a puzzle's goals, e.g. ["TSD 1", "ATTACK 6", "NO HOLD"]. */
export function requirementChips(requirements: readonly number[]): string[] {
  const chips: string[] = [];
  for (let i = 0; i < 7; i++) {
    const v = requirements[i] ?? 0;
    if (v > 0) chips.push(`${REQUIREMENT_NAMES[i]} ${v}`);
  }
  if (requirements[7]) chips.push(REQUIREMENT_NAMES[7]);
  return chips;
}

/** At least one of the 7 counted goals is set (NO HOLD alone isn't a goal). */
export function hasCountedGoal(requirements: readonly number[]): boolean {
  return requirements.slice(0, 7).some(v => v > 0);
}

export interface GoalProgress {
  name: string;
  have: number;
  need: number;
  met: boolean;
}

/** Progress on each counted goal the puzzle sets. */
export function goalProgress(requirements: Requirements, ledger: Ledger): GoalProgress[] {
  const counts = ledgerCounts(ledger);
  const out: GoalProgress[] = [];
  for (let i = 0; i < 7; i++) {
    const need = requirements[i] ?? 0;
    if (need > 0) {
      out.push({ name: REQUIREMENT_NAMES[i], have: counts[i], need, met: counts[i] >= need });
    }
  }
  return out;
}

/** 4.27s / 1:03.50 */
export function formatTime(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  if (total < 60) return `${total.toFixed(2)}s`;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** API puzzle → what PuzzlePlayer plays. */
export function specFromPuzzle(p: Puzzle): PuzzleSpec {
  return {
    board: boardFromBits(p.board),
    queue: queueFromApi(p.queue),
    requirements: p.requirements.slice(0, 8),
  };
}

/**
 * onClick for in-app `<a href>` links: a plain left click navigates in-app; modified clicks
 * (cmd/ctrl/shift/middle) fall through to the browser so "open in new tab" still works.
 */
export function linkClick(e: MouseEvent, go: () => void): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}

/** Keeps mouse clicks from focusing a button, so Space/Enter keep going to the game. */
export function noFocus(e: MouseEvent): void {
  e.preventDefault();
}

export function puzzlePath(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

export function profilePath(username: string): string {
  return `/u/${encodeURIComponent(username)}`;
}

// ---------------------------------------------------------------------------
// puzzles solved in this browser session (so "next puzzle" doesn't bounce between two
// puzzles for anonymous players, whose solves aren't recorded server-side)
// ---------------------------------------------------------------------------

const SESSION_SOLVED_KEY = 'plonktris-session-solved';

export function sessionSolved(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SESSION_SOLVED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function markSessionSolved(id: string): void {
  try {
    const s = sessionSolved();
    s.add(id);
    sessionStorage.setItem(SESSION_SOLVED_KEY, JSON.stringify([...s]));
  } catch {
    // storage unavailable — "next puzzle" just can't skip it
  }
}
