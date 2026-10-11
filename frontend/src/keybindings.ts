// Keybindings + handling (DAS / ARR / soft drop) settings, persisted in localStorage.

const STORAGE_KEY = 'plonktris-keybindings';
const HANDLING_KEY = 'plonktris-handling';

// ---------------------------------------------------------------------------
// handling
// ---------------------------------------------------------------------------

export interface Handling {
  /** delayed auto shift: ms a direction is held before it starts repeating */
  das: number;
  /** auto repeat rate: ms between repeats once DAS has charged; 0 = straight to the wall */
  arr: number;
  /** soft drop: ms per row while held; 0 = instantly to the floor */
  softDrop: number;
}

export const DEFAULT_HANDLING: Handling = { das: 133, arr: 10, softDrop: 0 };

/** Allowed range for each handling value (also the settings sliders' range). */
export const HANDLING_LIMITS: Record<keyof Handling, { min: number; max: number }> = {
  das:      { min: 0, max: 500 },
  arr:      { min: 0, max: 200 },
  softDrop: { min: 0, max: 200 },
};

function clampHandling(key: keyof Handling, value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_HANDLING[key];
  const { min, max } = HANDLING_LIMITS[key];
  return Math.round(Math.max(min, Math.min(max, n)));
}

/** Fills in missing fields and clamps everything into range. */
export function sanitizeHandling(raw: unknown): Handling {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    das:      saved.das      == null ? DEFAULT_HANDLING.das      : clampHandling('das', saved.das),
    arr:      saved.arr      == null ? DEFAULT_HANDLING.arr      : clampHandling('arr', saved.arr),
    softDrop: saved.softDrop == null ? DEFAULT_HANDLING.softDrop : clampHandling('softDrop', saved.softDrop),
  };
}

export function loadHandling(): Handling {
  try {
    return sanitizeHandling(JSON.parse(localStorage.getItem(HANDLING_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_HANDLING };
  }
}

export function saveHandling(handling: Handling): void {
  try {
    localStorage.setItem(HANDLING_KEY, JSON.stringify(handling));
  } catch {
    // private mode etc
  }
}

// ---------------------------------------------------------------------------
// bindings
// ---------------------------------------------------------------------------

export type BindingAction =
  | 'left' | 'right' | 'softDrop'
  | 'rotateCw' | 'rotateCcw' | 'rotate180'
  | 'hold' | 'place' | 'undo' | 'restart';

/** A binding is a key signature (see keySig), e.g. 'ArrowLeft', 'z', ' ', 'Shift', 'mod+z'; '' = unbound. */
export type Bindings = Record<BindingAction, string>;

export const DEFAULT_BINDINGS: Bindings = {
  left:      'ArrowLeft',
  right:     'ArrowRight',
  softDrop:  'ArrowDown',
  rotateCw:  'ArrowUp',
  rotateCcw: 'z',
  rotate180: 'a',
  hold:      'c',
  place:     ' ',
  undo:      'mod+z',
  restart:   'r',
};

/** Display order + labels. */
export const BINDING_LABELS: Record<BindingAction, string> = {
  left:      'move left',
  right:     'move right',
  softDrop:  'soft drop',
  rotateCw:  'rotate cw',
  rotateCcw: 'rotate ccw',
  rotate180: 'rotate 180',
  hold:      'hold',
  place:     'hard drop',
  undo:      'undo',
  restart:   'restart',
};

export const BINDING_ACTIONS = Object.keys(BINDING_LABELS) as BindingAction[];

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Meta', 'Alt', 'AltGraph']);

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

// single chars compare lowercase so shift state doesn't matter
export function normKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

// binding signature for an event: cmd and ctrl both count as "mod". A modifier pressed on its
// own (e.g. Shift bound to hold) is just its name.
export function keySig(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): string {
  if (isModifierKey(e.key)) return e.key;
  const mod = e.metaKey || e.ctrlKey ? 'mod+' : '';
  return mod + normKey(e.key);
}

// the un-modified key of a binding (for keyup matching, where the modifier
// may already have been released)
export function baseKey(binding: string): string {
  return binding.startsWith('mod+') ? binding.slice(4) : binding;
}

export function keyLabel(key: string): string {
  if (key === '') return '—';
  if (key.startsWith('mod+')) return `⌘/^ ${keyLabel(key.slice(4))}`;
  switch (key) {
    case ' ':          return 'SPACE';
    case 'ArrowLeft':  return '←';
    case 'ArrowRight': return '→';
    case 'ArrowUp':    return '↑';
    case 'ArrowDown':  return '↓';
    case 'Control':    return 'CTRL';
    case 'Meta':       return 'CMD';
    case 'Escape':     return 'ESC';
    default:           return key.toUpperCase();
  }
}

/** Short label for compact hints ("⌘Z" instead of "⌘/^ Z"). */
export function keyLabelShort(key: string): string {
  if (key.startsWith('mod+')) return `⌘${keyLabelShort(key.slice(4))}`;
  return keyLabel(key);
}

/**
 * Turns whatever is in localStorage into a full, conflict-free Bindings object.
 * - the old `clearBoard` action is now `restart` (its saved key carries over)
 * - actions added since the bindings were saved (e.g. rotate180) get their default key,
 *   unless the user already uses that key for something else — then they start unbound
 */
export function migrateBindings(raw: unknown): Bindings {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kept: Partial<Bindings> = {};
  for (const a of BINDING_ACTIONS) {
    if (typeof saved[a] === 'string') kept[a] = saved[a] as string;
  }
  if (kept.restart == null && typeof saved.clearBoard === 'string') kept.restart = saved.clearBoard;

  const taken = new Set(Object.values(kept).filter(Boolean));
  const out = { ...DEFAULT_BINDINGS };
  for (const a of BINDING_ACTIONS) {
    if (kept[a] != null) out[a] = kept[a]!;
    else out[a] = taken.has(DEFAULT_BINDINGS[a]) ? '' : DEFAULT_BINDINGS[a];
  }
  return out;
}

export function loadBindings(): Bindings {
  try {
    return migrateBindings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // private mode etc — bindings just won't persist
  }
}
