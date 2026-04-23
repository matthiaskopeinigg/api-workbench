# `core`

Application services and shared logic used across features. Imports use the `@core/…` path alias (see `tsconfig.json`).

| Folder | Contents |
|--------|----------|
| `collection/` | Collection tree and CRUD |
| `commands/` | Command palette registry, seeds, keyboard shortcuts panel |
| `environments/` | Workspace environments |
| `http/` | Request execution, cookies, auth signing, scripts, response/history helpers |
| `import-pipeline/` | OpenAPI/cURL import, batch import, intents, file batch dialog |
| `mock-server/` | Built-in mock HTTP server |
| `placeholders/` | `{{var}}` substitution (`env-substitute`) and `$` dynamic tokens |
| `platform/` | Electron window bridge, file dialogs, updates |
| `seeding/` | Sample workspace seeding |
| `session/` | Session / persisted UI state, view state |
| `settings/` | User settings and theme |
| `snippets/` | Code snippet generation for “copy as code” |
| `tabs/` | Workspace tab model and open/close/switch |
| `testing/` | Test runner, test suite, load tests, flow executor, contract validation, test artifacts, runner dialog |
| `utils/` | Small pure helpers: key-value, JSON/text diff, line diff for UI |
| `websocket/` | WebSocket client tab support |

**Note:** The old flat paths (`@core/collection.service`) are no longer used; point imports at the subfolder (e.g. `@core/collection/collection.service`).
