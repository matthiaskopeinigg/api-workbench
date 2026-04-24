# Command palette & shortcuts

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Command palette

- Open with the shortcut shown in **Settings → Keyboard** (commonly **Ctrl/Cmd + Shift + P** or **F1**, depending on binding).
- **Fuzzy search** commands by name; **arrow keys** to select; **Enter** to run.
- Commands are grouped by **category** (Workspace, Theme, Import, Mock server, Tests, …). Features register commands at runtime (see `CommandSeedsService` in source for the baseline list).

Examples of seeded commands:

- New collection, new WebSocket / SSE tab  
- Theme toggles, open settings, clear cookies  
- Import Postman / OpenAPI / cURL / batch / folder  
- Mock server start/stop, open mock tab  
- Open shortcuts panel, run test suite (where wired)

## Keyboard shortcuts

- **Settings → Keyboard** lists **all bindings** in a table: command name, chord, conflict hints.
- **Record** / **reset** per row as the UI provides.
- **Code editors** (request body, scripts, etc.) may use the same registry so shortcuts are consistent.

## Shortcuts panel

Some builds expose a **shortcuts** side panel or dialog summarizing effective bindings (especially for the editor).

## Related

- [Tabs & editor layout](Tabs-and-editor-layout).
- [Settings](Settings) — Keyboard tab is the source of truth for editing bindings.
