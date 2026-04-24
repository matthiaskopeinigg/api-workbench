# Testing artifacts

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Tests sidebar

Under **Tests** in the activity bar, four collapsible sections:

| Section | Tab type | Purpose (high level) |
|---------|----------|----------------------|
| **Load Tests** | Load test | Model load / concurrency against one or more requests; profiles and charts in the tab. |
| **Test Suites** | Test suite | Ordered collection of request steps with pass/fail and reporting. |
| **Contract Tests** | Contract test | Schema / contract style checks against responses. |
| **Flows** | Flow | Multi-step orchestration / workflow testing. |

## Sidebar actions

- **+** on a section header — create a new artifact.
- **Click** / **double-click** row — open the artifact in a dedicated tab.
- **Context menu** — open, rename, duplicate, delete.
- **Load tests** — quick-add **profile** from a template or empty row (per-item control in the list).

## Tabs

Each artifact opens in its own editor tab with tooling specific to that type (run buttons, environment pickers, result trees, time-series for load tests, etc.). Exact UI evolves with releases—inspect the tab toolbar and panels after opening.

## Related

- [Collections & folders](Collections-and-folders) — requests referenced by tests.
- [Command palette & shortcuts](Command-palette-and-shortcuts) — commands such as “run suite” when registered.
