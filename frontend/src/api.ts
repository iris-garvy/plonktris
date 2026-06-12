const API_URL = 'http://localhost:3000';
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
  created_at?: string;
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
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  register: (username: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request<Record<string, never>>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),
  listPuzzles: () => request<{ puzzles: Puzzle[] }>('/puzzles'),
  getPuzzle: (id: string) => request<Puzzle>(`/puzzles/${id}`),
};
