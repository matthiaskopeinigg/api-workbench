# Collections & folders

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Collections sidebar

Under **Collections** in the activity bar you get a **tree**:

- **Collection** — top-level container (name, reorder, delete, export depending on UI).
- **Folder** — nested grouping; can contain more folders, **requests**, and **WebSocket / SSE** entries.
- **Request** — one saved HTTP request (method, URL, headers, body, tests, mock variants, etc.).
- **WebSocket / SSE** — saved under the same folder or collection; appears with a **WS** or **SSE** badge. Same context-menu and tab flows as requests where implemented.

### Common actions

- **Open** a request or folder — opens a **tab** (request editor or folder overview).
- **Create** — new collection, folder, or request (toolbar / context menu / title flows as implemented).
- **Drag-and-drop** — reorder **folders** as siblings. **Requests** and **WebSocket / SSE** rows share a **single mixed list** in display order: you can place a WebSocket above or below an HTTP request. Drop on the **top half** of a row to insert *before* that row, or the **bottom half** to insert *after* (before the next row). To put an item **last** among those leaves, drop on the **lower half of the last** row, or the **narrow strip** between the last leaf and the first **folder** row (one orange indicator for “append at end”).
- **Context menu** — rename, duplicate, delete, move (where available).

## Folder tab

Opening a **folder** shows a tab scoped to that folder: summary and quick access to child requests (exact layout follows the current app build).

## Storage model

Everything lives in the local workspace database; collections serialize to JSON when you export or backup (see [Import & export](Import-and-export)).

## Related

- [Request editor](Request-editor) — editing a single request.
- [WebSocket tab](WebSocket-tab) — collection-backed WS / SSE entries.
- [Environments & variables](Environments-and-variables) — folder-level variables merge with environments.
