# Settings

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

Open from the **title bar** (gear icon). Settings open as a **modal** with a left nav and a content pane.

## Sidebar sections (tabs)

| Tab | Contents |
|-----|-----------|
| **User Interface** | Theme, compact mode, **restore open tabs on startup**, font size where applicable. |
| **Keyboard** | Shortcut bindings table; change keys, reset to defaults, record chord. |
| **Request Settings** | Defaults for new request tabs (e.g. which **section** is active first: Params, Headers, …). |
| **Retry Settings** | Global retry behavior for sends (counts, backoff—per current app options). |
| **Default Headers** | Headers automatically added to outbound requests unless disabled. |
| **Certificates & SSL** | Trust, client certs, managed certificates for HTTPS debugging. |
| **DNS Settings** | Custom DNS resolution options if exposed. |
| **Proxy Settings** | HTTP(S) proxy for outbound traffic. |
| **Databases** | Manage database connection profiles for testing flows. |
| **Data & config** | Paths to database and config; relocate data directory. |
| **Import & Export** | Bulk import/export entry points (see also [Import & export](Import-and-export)). |
| **About** | Version, **updater** status (check for updates, download), links to site/repo/wiki. |

## Persistence

Changes apply to the local profile immediately where the UI saves on blur/toggle; some paths require restart (data directory move).

## Related

- [Cookies](Cookies) — separate modal from the cookie button.
- [Command palette & shortcuts](Command-palette-and-shortcuts) — overlaps with Keyboard tab.
