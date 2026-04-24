# Getting started

> **Maintainers:** Sync to [GitHub Wiki](https://github.com/matthiaskopeinigg/api-workbench/wiki).

## What you see first

1. **Title bar** — App name, **Cookies**, **Settings**, and window controls (minimize / maximize / close).
2. **Activity bar** — Narrow strip on the far left: icons for **Collections**, **Environments**, **Tests**, and (below) **Mock Server**, **History**, **Help**.
3. **Editor area** — Horizontal **tab strip** across the top of the main region. Each tab is a document (request, folder summary, environment editor, etc.).
4. **Optional secondary sidebar** — Opens when you click an activity icon; shows the tree or list for that area (e.g. collection folders and requests).

Click an activity icon again or use the sidebar edge to **collapse** the secondary panel. Width and last-open panel are remembered for the session.

## Data storage

Collections, environments, history, test artifacts, and settings are stored **locally** (SQLite / on-disk paths shown under **Settings → Data & config**). Use your own backup or version control for team sharing; there is no built-in cloud sync.

## Next steps

- Organize work under [Collections & folders](Collections-and-folders).
- Configure [Environments & variables](Environments-and-variables) and pick an environment on each request.
- Open [Settings](Settings) for default headers, SSL, proxy, theme, and more.
