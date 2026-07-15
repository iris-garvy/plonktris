const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'plonktris-token';

export interface User {
  id: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

/** A published puzzle as served by GET /puzzles — prover byte formats. */
export interface Puzzle {
  id: string;
  name: string;
  creator: string | null;
  board: number[];          // 210 occupancy bits, row 0 = top
  queue: number[];          // prover piece ids 0-6
  requirements: number[];   // 8 bytes
  num_pieces: number;
  solve_count: number;
  attempt_count: number;
  created_at?: string;
}

/** An in-flight or failed submission (only returned for your own profile). */
export interface JobInfo {
  id: string;
  status: 'pending' | 'proving' | 'failed';
  kind: 'publish' | 'solve';
  name: string;
  failed_reason: string | null;
  submitted_at: string;
}

/** A user's public profile: their info plus puzzles created and solved. */
export interface UserProfile {
  username: string;
  created_at: string;
  created: Puzzle[];
  solved: Puzzle[];
  pending: JobInfo[];
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

/** Error thrown by request() on a non-2xx response, carrying the HTTP status. */
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
  if (body) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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

/** Puzzle identity fields shared by both proof endpoints. `name` is set when publishing
 *  a new puzzle; `puzzle_id` is set when solving an existing one (never both). */
interface ProofTarget {
  board: number[];
  queue: number[];
  requirements: number[];
  name?: string;
  puzzle_id?: string;
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
  getPuzzle: (id: string) => request<Puzzle>(`/puzzles/${id}`),
  // record that the current (logged-in) user opened this puzzle; idempotent server-side
  recordAttempt: (id: string) =>
    request<Record<string, never>>(`/puzzles/${id}/attempt`, { method: 'POST' }),
  getUserProfile: (username: string) =>
    request<UserProfile>(`/users/${encodeURIComponent(username)}`),
  getStats: () => request<SiteStats>('/stats'),
  getLeaderboard: () => request<{ leaders: LeaderEntry[] }>('/leaderboard'),

  // Submit an already-generated (in-browser) proof for synchronous verification.
  submitProof: (body: ProofTarget & { proof: number[] }) =>
    request<{ proof_id: string }>('/submit', { method: 'POST', body }),

  // Ask the server to prove the solution asynchronously. Returns { rateLimited: true }
  // instead of throwing when the per-user fast-proving limit (HTTP 429) is hit.
  requestServerProof: async (
    body: ProofTarget & { actions: number[] },
  ): Promise<{ proof_id: string } | { rateLimited: true }> => {
    try {
      return await request<{ proof_id: string }>('/request', { method: 'POST', body });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) return { rateLimited: true };
      throw e;
    }
  },
};
