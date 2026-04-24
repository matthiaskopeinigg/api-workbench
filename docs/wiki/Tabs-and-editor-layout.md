# Tabs & editor layout

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Tab strip

- Tabs appear across the **top of the main editor**.
- Types include **Request**, **Folder**, **Collection**, **Environment**, **History entry**, **WebSocket**, **Mock Server**, **Load test**, **Test suite**, **Contract test**, **Flow** (see [Home](Home) map).
- **Close** a tab with its close control; **reorder** by dragging tabs.
- Context actions (where available): close others, close to the right, close all in pane, **pin**, duplicate request surface.

## Split editor

- You can **split** the workspace into two panes (left/right or top/bottom) so two tab sets are visible.
- Drag tabs or use split actions from the tab context UI (unsplit: drag from the tab strip to **left/right dock strips** at the viewport edge to choose which pane gets the active tab, matching context-menu **Split left** / **Split right**).
- A **splitter** between panes resizes the ratio; **Close split** (join icon on the splitter) **merges** both tab strips into the primary pane and returns to a single column of tabs.
- If you **close every tab** while the split is focused on the second pane, the app should still open the **next** tab in the only visible (primary) strip — a regression was fixed so you do not get a blank workbench in that case.
- Each pane can have its own **environment override** for requests in that pane (when configured from the tab pane UI).

## Persistence

- **Settings → User Interface → Restore open tabs on startup** controls whether tabs are restored after restart.
- Tab order and selection are saved to session/workspace state (see Settings for related options).

## Related

- [Request editor](Request-editor) for the main Request tab.
- [Command palette & shortcuts](Command-palette-and-shortcuts) for keyboard-driven tab and command actions.
