# Environments & variables

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Environments sidebar

Under **Environments** you maintain **named sets of variables** (key/value). Typical keys: `baseUrl`, `apiKey`, `tenantId`, etc.

Clicking an environment opens an **Environment** tab (or focuses an existing one) with a variable grid editor for that set.

## Using variables on requests

- Choose the active **environment** from the request tab (dropdown near Params / Headers).
- Reference variables with **`{{variableName}}`** in URL, params, headers, auth fields, and body.
- Unknown names stay **literal** text.
- Type **`{{`** in supported fields for **autocomplete**; known names may be highlighted.

## Merging with folders

When a request lives under a **folder** that defines variables:

- **Environment** values **override** **folder** values when the same key exists in both.
- This lets you share defaults at folder level and override per environment.

## Dynamic placeholders (`$`)

After `{{…}}` resolution, the app can inject **per-send** values such as:

- `$uuid`, `$timestamp`, `$isoTimestamp`, `$isoDate`
- `$randomInt`, `$randomLong` (with optional digit count)

You can wrap in double braces, e.g. `{{$uuid}}`. See in-app **Help** for the canonical list.

## Related

- [Request editor](Request-editor).
- [Mock server](Mock-server) — mock response templates use **different** tokens (`{{header.Name}}`, `{{bodyJson…}}`), not environment variables.
