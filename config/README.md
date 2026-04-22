# Local workspace seed (test data)

When the SQLite store is **empty** (first launch or after you delete the app database), the Electron main process imports JSON from this folder into the database in this order:

| File | Document | Required |
|------|-----------|----------|
| `settings.json` | `settings` | No (default settings apply if missing) |
| `collections.json` | `collections` | For a useful workspace |
| `environments.json` | `environments` | No |
| `session.json` | `session_kv` (keys → values) | No |
| `loadTests.json` | `loadTests` | No (`{ "items": [] }` to clear) |
| `testSuites.json` | `testSuites` | No |
| `contractTests.json` | `contractTests` | No |
| `flows.json` | `flows` | No |
| `testSuiteSnapshots.json` | `testSuiteSnapshots` | No |

- **Path resolution (dev):** `app.getAppPath()/config` is used if the folder exists, otherwise `configs/` (legacy).
- **Re-importing:** Remove or rename your user data SQLite DB (e.g. under the OS user data directory for the app) so the store is empty, then start the app again.
- **Archiving:** Files in **`config/`** are **not** renamed to `*.bak` after import, so you can re-run the same project DB reset without re-copying files. Legacy `configs/` next to a packaged build still uses archiving.

**Packaged app:** Tries `configs/` next to the executable first, then `config/`.

Adjust these JSON files to match your local checks; the checked-in content mirrors the in-app public API sample workspace.
