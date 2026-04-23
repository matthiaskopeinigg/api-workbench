/**
 * Single source of truth for keyboard shortcut metadata (defaults + scope).
 * User overrides live in Settings.keyboard.bindings (action id → chord string).
 */
export type KeyboardShortcutScope = 'global' | 'editor';

export interface KeyboardShortcutDefinition {
  id: string;
  label: string;
  category: string;
  /** Default chord using event.code tokens, e.g. Mod+KeyK, Mod+Slash, Ctrl+Alt+Digit1 */
  defaultChord: string;
  scope: KeyboardShortcutScope;
  /**
   * When true, do not run this global shortcut if focus is in an input/textarea/select/contenteditable
   * (workspace pane focus shortcuts).
   */
  skipWhenInEditableField?: boolean;
  /**
   * When true, do not run this global shortcut if the event target is the main code textarea
   * (so the editor can use the same physical chord, e.g. Mod+Slash for line comment).
   */
  skipWhenInCodeEditorTextarea?: boolean;
}

export const KEYBOARD_SHORTCUT_CATALOG: readonly KeyboardShortcutDefinition[] = [
  {
    id: 'global.commandPaletteToggle',
    label: 'Toggle command palette',
    category: 'Global',
    defaultChord: 'Mod+KeyK',
    scope: 'global',
  },
  {
    id: 'global.shortcutsPanelToggle',
    label: 'Toggle keyboard shortcuts reference',
    category: 'Global',
    defaultChord: 'Mod+Slash',
    scope: 'global',
    skipWhenInCodeEditorTextarea: true,
  },
  {
    id: 'global.responseFind',
    label: 'Find in response body',
    category: 'Response',
    defaultChord: 'Mod+KeyF',
    scope: 'global',
  },
  {
    id: 'global.workspaceFocusPrimary',
    label: 'Focus primary split pane',
    category: 'Workspace',
    defaultChord: 'Ctrl+Alt+Digit1',
    scope: 'global',
    skipWhenInEditableField: true,
  },
  {
    id: 'global.workspaceFocusSecondary',
    label: 'Focus secondary split pane',
    category: 'Workspace',
    defaultChord: 'Ctrl+Alt+Digit2',
    scope: 'global',
    skipWhenInEditableField: true,
  },
  {
    id: 'global.workspaceToggleSplitOrientation',
    label: 'Toggle split orientation (when split)',
    category: 'Workspace',
    defaultChord: 'Ctrl+Alt+KeyO',
    scope: 'global',
    skipWhenInEditableField: true,
  },
  {
    id: 'editor.duplicateLine',
    label: 'Duplicate line',
    category: 'Editor',
    defaultChord: 'Mod+KeyD',
    scope: 'editor',
  },
  {
    id: 'editor.toggleLineComment',
    label: 'Toggle line comment',
    category: 'Editor',
    defaultChord: 'Mod+Slash',
    scope: 'editor',
  },
  {
    id: 'editor.moveLineUp',
    label: 'Move line up',
    category: 'Editor',
    defaultChord: 'Alt+ArrowUp',
    scope: 'editor',
  },
  {
    id: 'editor.moveLineDown',
    label: 'Move line down',
    category: 'Editor',
    defaultChord: 'Alt+ArrowDown',
    scope: 'editor',
  },
] as const;

export const KEYBOARD_SHORTCUT_IDS: readonly string[] = KEYBOARD_SHORTCUT_CATALOG.map((d) => d.id);

export function catalogEntryForId(id: string): KeyboardShortcutDefinition | undefined {
  return KEYBOARD_SHORTCUT_CATALOG.find((d) => d.id === id);
}
