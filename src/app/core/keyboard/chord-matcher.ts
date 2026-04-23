/**
 * Chord strings use + -separated tokens and event.code for the final key, e.g.:
 * - Mod+KeyK — primary modifier (Ctrl on Windows/Linux, Meta on macOS) + K
 * - Ctrl+Alt+Digit1 — Ctrl and Alt (not Meta-alone) + 1
 * - Alt+ArrowUp
 *
 * Mod expands to (ctrlKey || metaKey). Ctrl / Meta tokens require that key specifically.
 */

export interface ParsedChord {
  /** True if either Ctrl or Meta satisfies (Mod token). */
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  code: string;
}

const SINGLE_CHAR_TO_CODE: Record<string, string> = {
  '/': 'Slash',
  '.': 'Period',
  ',': 'Comma',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Equal',
};

export function parseChord(chord: string): ParsedChord | null {
  const raw = chord.trim();
  if (!raw) return null;
  const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
  let mod = false;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let code: string | null = null;

  for (const p of parts) {
    const u = p.toLowerCase();
    if (u === 'mod') {
      mod = true;
      continue;
    }
    if (u === 'ctrl' || u === 'control') {
      ctrl = true;
      continue;
    }
    if (u === 'meta' || u === 'cmd' || u === 'command') {
      meta = true;
      continue;
    }
    if (u === 'alt' || u === 'option') {
      alt = true;
      continue;
    }
    if (u === 'shift') {
      shift = true;
      continue;
    }
    code = normalizeKeyToken(p);
  }

  if (!code) return null;
  return { mod, ctrl, meta, alt, shift, code };
}

function normalizeKeyToken(p: string): string {
  if (p.startsWith('Key') || p.startsWith('Digit') || p.startsWith('Arrow') || p.startsWith('Numpad')) {
    return p;
  }
  if (p.length === 1) {
    const c = p;
    if (SINGLE_CHAR_TO_CODE[c]) return SINGLE_CHAR_TO_CODE[c];
    if (/[a-zA-Z]/.test(c)) return `Key${c.toUpperCase()}`;
    return c;
  }
  return p;
}

/** Serialize a keydown to a canonical chord string for display/recording. */
export function serializeChordFromEvent(ev: KeyboardEvent): string {
  const parts: string[] = [];
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  if (ev.ctrlKey || ev.metaKey) parts.push('Mod');
  if (ev.code) parts.push(ev.code);
  return parts.join('+');
}

export function keyboardEventMatchesChord(ev: KeyboardEvent, chord: string): boolean {
  const spec = parseChord(chord);
  if (!spec) return false;

  const hasCtrl = ev.ctrlKey;
  const hasMeta = ev.metaKey;
  const hasMod = hasCtrl || hasMeta;

  if (spec.mod) {
    if (!hasMod) return false;
  }
  if (spec.ctrl && !hasCtrl) return false;
  if (spec.meta && !hasMeta) return false;
  if (!spec.mod && !spec.ctrl && !spec.meta && hasMod) return false;

  if (spec.alt !== ev.altKey) return false;
  if (spec.shift !== ev.shiftKey) return false;
  return ev.code === spec.code;
}

function chordTupleKey(spec: ParsedChord): string {
  return `${spec.mod}:${spec.ctrl}:${spec.meta}:${spec.alt}:${spec.shift}:${spec.code}`;
}

export function validateBindingMap(
  bindings: Record<string, string>,
  catalogIds: readonly string[],
): { ok: true } | { ok: false; message: string } {
  const used = new Map<string, string>();
  for (const id of catalogIds) {
    const chord = bindings[id];
    if (!chord?.trim()) continue;
    const spec = parseChord(chord);
    if (!spec) {
      return { ok: false, message: `Invalid chord for ${id}` };
    }
    const key = chordTupleKey(spec);
    const existing = used.get(key);
    if (existing && existing !== id) {
      return { ok: false, message: `Chord "${chord}" is used by both "${existing}" and "${id}"` };
    }
    used.set(key, id);
  }
  return { ok: true };
}
