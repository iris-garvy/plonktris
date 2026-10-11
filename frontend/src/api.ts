const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'plonktris-token';
const USER_KEY = 'plonktris-user';

export interface User {
  id: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

/** A published puzzle as served by the API (API formats — see game/engine.ts for conversions). */
export interface Puzzle {
  id: string;
  name: string;
  creator: string | null;
  board: number[];          // 210 occupancy bits, row 0 = top
  queue: number[];          // API piece ids 0-6
  requirements: number[];   // 8 bytes: tss, tsd, tst, tetris, pc, attack, max_combo, no_hold
  num_pieces: number;
  solve_count: number;
  attempt_count: number;
  created_at?: string;
  /** the logged-in viewer has a recorded solve (always false when anonymous) */
  solved_by_me: boolean;
}

/** A user's public profile: their info plus puzzles created and solved. */
export interface UserProfile {
  username: string;
  created_at: string;
  created: Puzzle[];
  solved: Puzzle[];
}

export interface PublishBody {
  name: string;
  board: number[];          // 210 occupancy bits
  queue: number[];          // API piece ids 0-6
  requirements: number[];   // 8 bytes
  solution: number[];       // action bytes
}

export interface SolveResult {
  /** this solve was recorded (first time for this user, and they're not the creator) */
  new_solve: boolean;
  /** this was the puzzle's first-ever solve */
  first_solve: boolean;
  solve_count: number;
}

// ---------------------------------------------------------------------------
// session (token + the user it belongs to, cached so the header is right on first paint)
// ---------------------------------------------------------------------------

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getCachedUser(): User | null {
  if (!getToken()) return null;
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
    return u && typeof u.id === 'string' && typeof u.username === 'string' ? u : null;
  } catch {
    return null;
  }
}

/** Stores (or with `null`, clears) the session. */
export function setSession(token: string | null, user: User | null = null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (token && user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // storage unavailable (private mode etc) — the session just won't survive a reload
  }
}

// ---------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------

interface RequestOptions {
  method?: string;
  body?: unknown;
}

/** Error thrown by request() on a non-2xx response (status 0 = couldn't reach the server). */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("couldn't reach the server", 0);
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const text = await res.text();
      try { msg = JSON.parse(text).error ?? text; } catch { msg = text || msg; }
    } catch { /* keep statusText */ }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

/** A short, human-readable version of any error thrown by the api. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return "couldn't reach the server — check your connection and try again";
    if (err.status >= 500) return 'the server hit a snag — try again in a moment';
    if (err.status === 429) return err.message || 'slow down a little and try again in a moment';
    return err.message || `request failed (${err.status})`;
  }
  return err instanceof Error ? err.message : String(err);
}

export type ReqFilter = 'tspin' | 'tetris' | 'pc' | 'attack' | 'combo' | 'nohold';

/** Filters for GET /puzzles — all optional. */
export interface PuzzleFilters {
  q?: string;
  min_pieces?: number;
  max_pieces?: number;
  solved?: 'solved' | 'unsolved';  // ever solved by anyone, vs never
  sort?: 'new' | 'solves';
  reqs?: ReqFilter[];              // AND-combined requirement filters
  featured?: boolean;             // only editorially-featured puzzles
  limit?: number;                 // cap result count
}

/** Site-wide totals for the home dashboard. */
export interface SiteStats {
  puzzles: number;
  solves: number;
  users: number;
}

/** A row in the solver leaderboard. */
export interface LeaderEntry {
  username: string;
  solves: number;
  first_solves: number;
}

function toQueryString(filters: PuzzleFilters): string {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set('q', filters.q.trim());
  if (filters.min_pieces != null) params.set('min_pieces', String(filters.min_pieces));
  if (filters.max_pieces != null) params.set('max_pieces', String(filters.max_pieces));
  if (filters.solved) params.set('solved', filters.solved);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.reqs?.length) params.set('reqs', filters.reqs.join(','));
  if (filters.featured) params.set('featured', 'true');
  if (filters.limit != null) params.set('limit', String(filters.limit));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  register: (username: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request<Record<string, never>>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),

  listPuzzles: (filters: PuzzleFilters = {}) =>
    request<{ puzzles: Puzzle[] }>(`/puzzles${toQueryString(filters)}`),
  getPuzzle: (id: string) => request<Puzzle>(`/puzzles/${encodeURIComponent(id)}`),
  /** record that the current (logged-in) user opened this puzzle; idempotent server-side */
  recordAttempt: (id: string) =>
    request<Record<string, never>>(`/puzzles/${encodeURIComponent(id)}/attempt`, { method: 'POST' }),
  /** publish a new puzzle; the server replays `solution` to check it's solvable */
  publishPuzzle: (body: PublishBody) =>
    request<{ id: string }>('/puzzles', { method: 'POST', body }),
  /** submit a solve; the server replays it against the stored puzzle */
  solvePuzzle: (id: string, solution: number[]) =>
    request<SolveResult>(`/puzzles/${encodeURIComponent(id)}/solve`, { method: 'POST', body: { solution } }),

  getUserProfile: (username: string) =>
    request<UserProfile>(`/users/${encodeURIComponent(username)}`),
  getStats: () => request<SiteStats>('/stats'),
  getLeaderboard: () => request<{ leaders: LeaderEntry[] }>('/leaderboard'),
};
