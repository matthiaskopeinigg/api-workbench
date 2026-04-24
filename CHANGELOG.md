# Changelog

All notable changes to **API Workbench** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for stable releases. Snapshot lines (e.g. `1.1.0-SNAPSHOT`) are pre-release identifiers.

## [1.1.0-SNAPSHOT] - 2026-04-23

Pre-release snapshot on the **1.1.x** line (tag `v1.1.0-SNAPSHOT`).  
Full file-level diff since **v1.0.1**:  
<https://github.com/matthiaskopeinigg/api-workbench/compare/v1.0.1...v1.1.0-SNAPSHOT>

### Added

- **Workspace tab layout** — split the tab workspace into panes, with split preview and dock strips for predictable docking.
- **Tab pane** — dedicated tab strip / pane for workspace tabs, including drag-and-drop reorder within a strip and **moves between panes**.
- **Keyboard shortcuts** — persisted bindings, central shortcut service with **chord** parsing, and a catalog of default actions.
- **Settings → Keyboard** — new tab to browse shortcuts, record bindings, and reset to defaults.
- **In-app confirm / alert** — non-native dialogs for confirmations used by the updated flows (replacing blocking system prompts where integrated).
- **Shortcuts panel** — shortcut list derived from the catalog and **effective** bindings so the panel matches what actually runs.

### Changed

- **Auto-update (packaged)** — no background download on discovery; a bottom **banner** offers **Download and install** (About tab matches). After download, the app can restart into the installer in one step; a small **“Installing update…”** window appears while the process hands off so the short pause after the main window closes is not mistaken for a hang.
- **Workspace `tab` UI** — large layout and styling pass on the tab container to support splits, DnD, and pane model; related **collection** sidebar drag-and-drop adjustments.
- **Code editor & simple editor** — keyboard shortcuts are honored while focus is in editors (without duplicating fragile per-component listeners everywhere).
- **Load test** — time-series chart visibility and styling tweaks.
- **Request tab** — interaction and styling adjustments aligned with the new tab workspace behavior.

### Fixed

- **Stuck “grab” cursor after tab drag** — drag state is cleared only when the pane that started the drag still owns it; improved edge cases for strip drops, drag start ordering during reorder, and a **`window` `mouseup` fallback** when `dragend` does not run after DOM updates during reorder.
- **Empty editor after split + close** — closing the last tab in a **split to the right** (or the only tab while the split’s focus was on the right pane) left internal focus on the **secondary** pane even though the UI is unsplit. New tabs were routed to the hidden pane. Focus now resets to the **primary** pane when the workspace is empty, with a guard when opening tabs while unsplit.
- **Collections sidebar order** — requests and **WebSocket / SSE** entries share one **reorderable** list per folder/collection: drag **between** any row, drop on the **lower half** of a row to insert after it, or use the **strip above folders** to append **last** among leaves. (Avoided duplicate drop-indicator lines for “append as last item”.)

### Release

- Packaging / metadata: version line set to **`1.1.0-SNAPSHOT`** (Spring-style snapshot). Release title in CI follows packaged `releaseInfo` (`v${version}`).

---

## [1.0.1] - 2026-04-23

Stable patch on **1.0.x**. See GitHub [release v1.0.1](https://github.com/matthiaskopeinigg/api-workbench/releases/tag/v1.0.1) and compare [v1.0.0…v1.0.1](https://github.com/matthiaskopeinigg/api-workbench/compare/v1.0.0...v1.0.1).

## [1.0.0] - 2026-04-23

Initial public **1.0.0** on the stable line. See GitHub [release v1.0.0](https://github.com/matthiaskopeinigg/api-workbench/releases/tag/v1.0.0).

[1.1.0-SNAPSHOT]: https://github.com/matthiaskopeinigg/api-workbench/releases/tag/v1.1.0-SNAPSHOT
[1.0.1]: https://github.com/matthiaskopeinigg/api-workbench/releases/tag/v1.0.1
[1.0.0]: https://github.com/matthiaskopeinigg/api-workbench/releases/tag/v1.0.0
