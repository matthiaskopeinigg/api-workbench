# Import & export

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Where imports live

- **Command palette** and **menu intents** — e.g. **Import Postman**, **Import OpenAPI**, **Import cURL**, **Import batch files**, **Import from folder** (exact labels follow the command registry).
- **Settings → Import & Export** — backup / restore and tool-specific import flows exposed there.
- **Home / landing** — drag-and-drop or buttons for collections (when shown in your build).

## Supported sources (typical)

- **Postman** collections / environments (as implemented by the import pipeline).
- **OpenAPI** (Swagger) — generate or merge requests into collections.
- **cURL** — paste a command to create or update a request.
- **Batch files** — multi-file import.
- **Folder** — structured folder import with options dialog.

## Export

Use collection / workspace export actions in the UI or Settings tab to write **JSON** (or other formats) for backup or sharing.

## Related

- [Collections & folders](Collections-and-folders) — where imported items land.
- [Settings](Settings) — **Data & config** for raw paths.
