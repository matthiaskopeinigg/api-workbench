import {
  keyboardEventMatchesChord,
  parseChord,
  serializeChordFromEvent,
  validateBindingMap,
} from './chord-matcher';
import { KEYBOARD_SHORTCUT_IDS } from './keyboard-shortcut-catalog';

function ev(partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, 'code'>): KeyboardEvent {
  return partial as KeyboardEvent;
}

describe('chord-matcher', () => {
  describe('parseChord', () => {
    it('parses Mod+KeyK', () => {
      const p = parseChord('Mod+KeyK');
      expect(p).toEqual(
        jasmine.objectContaining({ mod: true, ctrl: false, meta: false, alt: false, shift: false, code: 'KeyK' }),
      );
    });

    it('parses Ctrl+Alt+Digit1', () => {
      const p = parseChord('Ctrl+Alt+Digit1');
      expect(p).toEqual(
        jasmine.objectContaining({ mod: false, ctrl: true, meta: false, alt: true, shift: false, code: 'Digit1' }),
      );
    });

    it('normalizes slash token', () => {
      const p = parseChord('Mod+/');
      expect(p?.code).toBe('Slash');
    });

    it('returns null for invalid chord', () => {
      expect(parseChord('')).toBeNull();
      expect(parseChord('Mod+')).toBeNull();
    });
  });

  describe('keyboardEventMatchesChord', () => {
    it('treats Mod as ctrl or meta', () => {
      expect(
        keyboardEventMatchesChord(ev({ code: 'KeyK', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), 'Mod+KeyK'),
      ).toBeTrue();
      expect(
        keyboardEventMatchesChord(ev({ code: 'KeyK', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }), 'Mod+KeyK'),
      ).toBeTrue();
      expect(
        keyboardEventMatchesChord(ev({ code: 'KeyK', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }), 'Mod+KeyK'),
      ).toBeFalse();
    });

    it('rejects extra modifier when chord has no Mod/Ctrl/Meta', () => {
      expect(
        keyboardEventMatchesChord(ev({ code: 'KeyF', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), 'KeyF'),
      ).toBeFalse();
    });

    it('matches shift when required', () => {
      expect(
        keyboardEventMatchesChord(
          ev({ code: 'KeyD', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }),
          'Mod+Shift+KeyD',
        ),
      ).toBeTrue();
    });

    it('matches Alt+ArrowUp', () => {
      expect(
        keyboardEventMatchesChord(
          ev({ code: 'ArrowUp', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }),
          'Alt+ArrowUp',
        ),
      ).toBeTrue();
    });
  });

  describe('serializeChordFromEvent', () => {
    it('orders Alt, Shift, Mod then code', () => {
      const s = serializeChordFromEvent(
        ev({ code: 'Slash', altKey: true, shiftKey: true, ctrlKey: true, metaKey: false }),
      );
      expect(s).toBe('Alt+Shift+Mod+Slash');
    });
  });

  describe('validateBindingMap', () => {
    it('accepts non-overlapping bindings', () => {
      const r = validateBindingMap(
        { 'global.commandPaletteToggle': 'Mod+KeyK', 'editor.duplicateLine': 'Mod+KeyD' },
        KEYBOARD_SHORTCUT_IDS,
      );
      expect(r).toEqual({ ok: true });
    });

    it('rejects duplicate chord for two actions', () => {
      const r = validateBindingMap(
        { 'global.commandPaletteToggle': 'Mod+KeyK', 'editor.duplicateLine': 'Mod+KeyK' },
        KEYBOARD_SHORTCUT_IDS,
      );
      expect(r.ok).toBeFalse();
      if (!r.ok) {
        expect(r.message).toContain('both');
      }
    });

    it('rejects invalid chord string', () => {
      const r = validateBindingMap({ 'global.commandPaletteToggle': 'Mod+' }, KEYBOARD_SHORTCUT_IDS);
      expect(r.ok).toBeFalse();
    });
  });
});
