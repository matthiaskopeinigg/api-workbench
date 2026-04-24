# Request editor

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Overview

The **Request** tab is the main HTTP client: configure a call, **Send** it, and inspect the **response** (status, headers, body, timing). One tab = one request surface; you can duplicate a tab to edit the same underlying request in two panes.

## URL & method

- Pick **HTTP method** (GET, POST, …) and enter the **URL**.
- Path segments like `:id` are treated as **path parameters**; define values in **Params** (type **path**).

## Params

- **Query** — query string key/values.
- **Path** — values for `:param` segments in the URL.

## Headers

- Key/value grid; enable/disable rows.
- **Default headers** from [Settings](Settings) can apply unless disabled per header where the UI allows.

## Body

Modes typically include: none, JSON, XML, text, GraphQL, **form-data**, **urlencoded**, **binary** (file). The editor adapts (raw editor, form table, etc.).

## Auth

Supports common schemes (Bearer, Basic, API key, OAuth2, etc.) depending on build—configure in the **Auth** section; values can use `{{variables}}`.

## Scripts

- **Pre-request** and **Tests** script areas (JavaScript) run in the main process for the send lifecycle; use for dynamic setup and assertions.

## Send & response

- **Send** executes the request (respects **environment**, **proxy**, **SSL**, **redirect** options from settings / request).
- **Response** area: body (pretty/raw), headers, search, diff against another response when available.
- **Response history** can be tied to the request for quick recall (see product UI).

## Mock variants (same tab)

Lower section: **Mock variants** for the built-in [Mock server](Mock-server): add variants, **Served** toggles, matchers, copy mock URL when the server is running. You can jump to the full **Mock Server** tab from here.

## Variables & placeholders

- `{{name}}` — environment / folder variables (see [Environments & variables](Environments-and-variables)).
- `$uuid`, `$timestamp`, etc. — dynamic placeholders; type `$` or `{{` for autocomplete where implemented.

## Related

- [History](History) — past sends.
- [Settings → Requests](Settings) — default active section when opening a new request tab.
