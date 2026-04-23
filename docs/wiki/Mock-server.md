# Mock server

> **Maintainers:** This file is meant to be copied or synced to the [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki). The same topics appear in the in-app **Help** dialog (activity bar → Help).

## Overview

API Workbench includes a **built-in HTTP mock server** bound to your workspace. It serves:

- **Collection-backed mocks** — mock variants attached to saved requests.
- **Standalone mocks** — routes you define only on the mock server (not tied to a collection request).

Open **Mock Server** from the activity bar: it opens the Mock Server **tab** and the **Endpoints** side panel so you can pick a route or manage standalones.

## Starting and URLs

1. Open the **Mock Server** tab.
2. Choose **port** (or leave empty for auto) and **bind address** (`127.0.0.1` vs `0.0.0.0`).
3. Click **Start**. The **base URL** (e.g. `http://127.0.0.1:3000`) is shown while running.

Point normal HTTP requests at that origin. In the main app, environment variables often reference `{{host}}` or a literal base URL for the mock.

## Collection routes

- Add **mock variants** on a request (status, headers, body, delay).
- Mark one variant as **active** (or call a specific variant by id in the URL).
- Default URL shape: **`/mock/<requestId>`**  
  Optional: **`/mock/<requestId>/<variantId>`** to hit a specific variant.

The app can show a **Copy** URL for the active variant when the server is running.

## Standalone routes

- Each standalone has an HTTP **method**, **path**, and the same variant model as collection mocks.
- Paths may use wildcards:
  - **`*`** suffix — e.g. `/api/users/*` matches one extra segment under `/api/users/`.
  - **`**`** suffix — e.g. `/api/**` matches `/api` and any subpath.

## Per-request response templates

In a variant’s **response body** and **response header values**, you can use placeholders that are expanded **for each incoming request** by the mock process.

These are **not** the same as workspace **environment** `{{variableName}}` substitution on outbound requests from the request tab.

| Placeholder | Meaning |
|-------------|---------|
| `{{header.Name}}` | Header value (header name matched case-insensitively). Raw text. |
| `{{headerJson.Name}}` | Same as JSON string literal (safe inside a JSON response body). |
| `{{body}}` | Raw captured request body as text. |
| `{{bodyJson}}` | Whole request body as a JSON string literal (for embedding in JSON). |
| `{{bodyJson.accessToken}}` | Dot path into the **parsed JSON** body (e.g. `user.id`, `items.0`). Value is JSON-stringified; use inside JSON. If the path is missing or the body is not valid JSON, expands to JSON `null`. |

**Request body capture:** enable **Capture request & response bodies** (Mock Server → Advanced) so `{{body}}` / `{{bodyJson…}}` receive the client’s request body. Without capture, those placeholders may be empty.

## Activity log

The Mock Server tab can show an **activity** pane: recent hits, filters, and optional captured request/response bodies in the log (separate from variant template expansion).

## Advanced options

- **Default delay**, **CORS**, **default Content-Type**, **auto-start** on launch, **capture bodies** for the hit log.
- **Bind `0.0.0.0`** makes the server reachable on your LAN interface (the UI warns when running).

## Related

- In-app **Help** (activity bar) summarizes environments, `$` dynamic tokens, and this mock behavior.
- Implementation reference: `electron/services/mock.service.js` (routing, template expansion, CORS).
