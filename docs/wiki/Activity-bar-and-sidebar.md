# Activity bar & sidebar

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## Activity bar (left strip)

| Icon / label | Opens |
|--------------|--------|
| **Collections** | Secondary sidebar: collections → folders → requests. Primary way to open and organize HTTP requests. |
| **Environments** | Secondary sidebar: list of environments; open one to edit variables. |
| **Tests** | Secondary sidebar: **Load Tests**, **Test Suites**, **Contract Tests**, **Flows** — create, rename, open artifacts (see [Testing artifacts](Testing-artifacts)). |
| **Mock Server** | Opens the **Mock Server** tab **and** the **Endpoints** sidebar (collection routes + standalone mocks). Same as choosing Mock Server from the tab strip if already open. |
| **History** | Secondary sidebar: recent sent requests; open an entry to resend or inspect. |
| **Help** | Modal with short tips and a link to this wiki (not a separate sidebar). |

## Secondary sidebar behavior

- **One panel at a time** — Selecting a different activity item switches the sidebar content.
- **Resize** — Drag the inner edge between sidebar and editor; width is persisted.
- **Mock Server** is special: it both focuses the **Mock Server** tab and shows the **Endpoints** rail so you can jump between collection mocks and standalones.

## Related

- [Tabs & editor layout](Tabs-and-editor-layout) for how tabs relate to the sidebar.
- [Home](Home) for the full doc map.
