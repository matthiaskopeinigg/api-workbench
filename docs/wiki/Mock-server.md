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

- Add **mock variants** on a request (status, headers, body, delay, optional **matchers**, **Served** toggle).
- Use **Served** checkboxes to choose which variants participate in **`/mock/<requestId>`**; add **`/mock/<requestId>/<variantId>`** to force one variant (overrides matcher selection for that hit).
- Default URL shape: **`/mock/<requestId>`**  
  Optional: **`/mock/<requestId>/<variantId>`** as above.

The app can show a **Copy** URL per variant when the server is running.

### Multiple responses for the same path (request matchers)

You can define **several variants on the same mock URL** and serve **different canned responses** depending on the incoming request (similar in spirit to WireMock stub priorities).

- In the **Mock Server** tab or on the request’s **Mock Variants** section, use **Match incoming request** on each variant.
- **All** configured predicates on a variant must pass (**AND**). Predicate kinds include literal **method**, **method regex**, **path/query substring**, **path+query regex** (same haystack as substring; dot-all), **header** rules (exact → regex → contains → “must be present”), **body** substring and **full-body regex**, **query** param (exact value or **value regex**; regex wins if both are set), **JSON path** with either exact JSON equality or a **regex on the stringified** value at that path.
- **Variant order matters**: the server walks variants **top to bottom** and uses the **first** variant whose matchers all pass.
- Variants **with no matchers** behave as a **default / fallback** after no matcher-only variant matches; if several have no matchers, the **first** wins among **served** variants. Further fallbacks use the legacy primary id (first served in list order), then the first served variant.

**Tip:** Put **specific** rules higher in the list and a **catch-all** variant (no matchers) last.

### Which variants are “served” on the unpinned URL

Each variant has a **Served** checkbox (Mock Server tab and the request’s Mock Variants section).

- When **all** are checked (default for older workspaces), **every** variant can win matcher selection for **`/mock/<requestId>`** (or the standalone path without a variant segment).
- Uncheck variants you want to **keep saved** but **exclude** from automatic resolution (e.g. drafts or retired stubs). Only checked ids are sent to the mock process as **`activeMockVariantIds`** / **`activeVariantIds`**.
- If **none** are checked, the unpinned URL returns **404** until you check at least one again (or call **`/mock/<requestId>/<variantId>`** to force a specific variant regardless of the served set).

## Standalone routes

- Each standalone has an HTTP **method**, **path**, and the same variant model as collection mocks.
- Paths may use wildcards:
  - **`*`** suffix — e.g. `/api/users/*` matches one extra segment under `/api/users/`.
  - **`**`** suffix — e.g. `/api/**` matches `/api` and any subpath.
- To delete a standalone mock route, right-click the endpoint in the **Mock Server** sidebar to open the context menu and select **Delete endpoint**.

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

The mock process **reads the request body** (up to 64KB) for **matchers** and for **`{{body}}` / `{{bodyJson…}}` templates** regardless of the activity log setting. **Capture request & response bodies** (Mock Server → Advanced) only controls whether **hit log** entries store full bodies; it does not disable template expansion or matcher evaluation.

## Activity log

The Mock Server tab can show an **activity** pane: recent hits, filters, and optional captured request/response bodies in the log (separate from variant template expansion).

## Advanced options

- **Default delay**, **CORS**, **default Content-Type**, **auto-start** on launch, **capture bodies** for the hit log.
- **Bind `0.0.0.0`** makes the server reachable on your LAN interface (the UI warns when running).

## Related

- In-app **Help** (activity bar) summarizes environments, `$` dynamic tokens, and this mock behavior.
- Implementation reference: `electron/services/mock.service.js` (routing, template expansion, CORS).
