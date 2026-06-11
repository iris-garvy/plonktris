const STORAGE_KEY = 'plonktris-keybindings';
const HANDLING_KEY = 'plonktris-handling';

export const DEFAULT_HANDLING = { das: 150, arr: 30 };

export function loadHandling() {
  try {
    const saved = JSON.parse(localStorage.getItem(HANDLING_KEY) ?? '{}');
    return { ...DEFAULT_HANDLING, ...saved };
  } catch {
    return { ...DEFAULT_HANDLING };
  }
}

export function saveHandling(handling) {
  try {
    localStorage.setItem(HANDLING_KEY, JSON.stringify(handling));
  } catch {
    // private mode etc
  }
}

export const DEFAULT_BINDINGS = {
  left:      'ArrowLeft',
  right:     'ArrowRight',
  softDrop:  'ArrowDown',
  rotateCw:  'ArrowUp',
  rotateCcw: 'z',
  hold:      'c',
  place:     ' ',
};

export const BINDING_LABELS = {
  left:      'move left',
  right:     'move right',
  softDrop:  'soft drop',
  rotateCw:  'rotate cw',
  rotateCcw: 'rotate ccw',
  hold:      'hold',
  place:     'place',
};

// single chars compare lowercase so shift state doesn't matter
export function normKey(key) {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function keyLabel(key) {
  switch (key) {
    case ' ':          return 'SPACE';
    case 'ArrowLeft':  return '←';
    case 'ArrowRight': return '→';
    case 'ArrowUp':    return '↑';
    case 'ArrowDown':  return '↓';
    default:           return key.length === 1 ? key.toUpperCase() : key;
  }
}

export function loadBindings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...DEFAULT_BINDINGS, ...saved };
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // private mode etc — bindings just won't persist
  }
}
