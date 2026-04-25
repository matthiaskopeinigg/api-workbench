# WebSocket tab

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Purpose

The **WebSocket** tab is a **playground** for interactive **WebSocket** and **SSE** (Server-Sent Events) sessions: connect to a URL, send messages, and view incoming frames/events.

## Opening a tab

- **Command palette** — commands like **New WebSocket tab** / **New SSE tab** (see [Command palette & shortcuts](Command-palette-and-shortcuts)).
- **Saved entries** — Under each collection or folder, use **Create WebSocket** from the context menu, then click the row (WS / SSE badge) to open a tab backed by that entry. In the **Collections** tree, those rows live in the **same ordered list** as HTTP requests; use drag-and-drop to reorder them together (see [Collections & folders](Collections-and-folders)).
- Other entry points may exist in menus or shortcuts depending on version.

## Saved vs scratch tabs

- **Saved (collection)** — Rows stored under `websocketRequests` on a collection or folder. URL, mode, headers, sub-protocols, message draft, and auth are persisted. The frame log is **not** saved.
- **Scratch** — Tabs created from the command palette use ephemeral ids (for example `ws-…`). They are not listed in the sidebar and are not written to collection JSON.

## Typical workflow

1. Choose an **Environment** (dropdown in the top right) if you need variable substitution.
2. Enter **URL** (`ws://` or `wss://` for WebSocket; `http(s)` for SSE). Both support `{{variables}}` and dynamic placeholders like `$uuid`.
3. Optional: Configure **Headers**, **Auth**, or **Sub-protocols** (WebSocket only). These also support variable resolution.
4. **Connect**; observe connection state on the status strip. If a connection fails, the full error text appears on a **separate row** under the URL bar.
5. **Send** text when connected (SSE is receive-only). The message editor supports syntax highlighting and `{{` autocomplete. Use the **Log** section for the frame/event list and **Clear** to reset it.

## Variables & placeholders

The WebSocket and SSE tabs share the same variable resolution engine as the HTTP Request tab:

- **Environment variables** — `{{my_api_key}}` resolved from the active environment.
- **Folder variables** — Inherited from parent folders in the collection.
- **Dynamic placeholders** — `$uuid`, `$timestamp`, `$isoDate`, etc. are generated at the moment of connection or message send.
- **Autocomplete** — Type `{{` in any input field or the message editor for a list of available variables.

## Auth (v1)

Supported types: **None**, **Bearer**, **Basic**, and **API key**. 

All auth fields (Tokens, Usernames, Keys) support variable substitution (`{{…}}`).

At **Connect**, the app builds a header map as follows:

1. **Manual headers** — Enabled rows with non-empty keys; keys and values are resolved with the same placeholder rules as HTTP (active environment variables and parent folder variables, plus dynamic placeholders).
2. **Auth-derived headers** — Merged on top. If a header name matches a manual row, **auth wins**.

OAuth2, Digest, AWS SigV4, Hawk, NTLM, and **inherit** are not applied on this path yet; use manual headers if needed until shared resolution exists.

## Differences from HTTP request tab

- Stateful **connection** rather than one-off request/response cycles (though HTTP may reuse connections under the hood).
- Message-oriented UI instead of a single response body panel.
- **Load tests** remain HTTP-only; WebSocket entries are not load targets.

## Related

- [Request editor](Request-editor) for standard HTTP.
- [Settings](Settings) — SSL / proxy may still affect outbound connections.
