// Piece colours (cell values 1-7, 8 = garbage) and small colour helpers for canvas drawing.

export const PIECE_COLORS: Record<number, string> = {
  1: '#00f5ff', // I
  2: '#ffe600', // O
  3: '#a000f0', // T
  4: '#00e000', // S
  5: '#f00000', // Z
  6: '#f0a000', // L
  7: '#0000f0', // J
  8: '#b1b1b1', // garbage
};

function parseHex(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mixes `hex` with `other` (default black): amount 0 = hex, 1 = other. Like CSS color-mix. */
export function mix(hex: string, amount: number, other = '#000000'): string {
  const a = parseHex(hex), b = parseHex(other);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
