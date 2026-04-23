# Releasing API Workbench

This project follows the same **ideas** as [Spring Boot](https://github.com/spring-projects/spring-boot): a single integration branch, optional **maintenance lines** for patches, immutable **version tags**, and **GitHub Releases** built from those tags (see their [releases](https://github.com/spring-projects/spring-boot/releases) and branch layout).

## Branches

| Branch | Purpose |
|--------|--------|
| **`main`** | Default branch. Day-to-day development and the next **minor or major** release. All PRs should target `main` unless you are fixing a released line. |
| **`{major}.{minor}.x`** | **Maintenance line** (e.g. `1.0.x`). Created when you need **patch-only** work after `main` has moved on (e.g. security or bugfix for `1.0.z` while `main` is already `1.1.0` or higher). Only fixes and patch version bumps belong here. |

Do **not** use long-lived feature branches on the remote for release history; use short-lived branches and merge to `main` or to the relevant `*.x` branch.

## Version numbers

- **`package.json`** / `package-lock.json` (root) **must** match the release you are cutting: `MAJOR.MINOR.PATCH` with [semver](https://semver.org/).
- **Pre-releases** (optional): `1.1.0-rc.1`, `1.1.0-beta.1`, etc. Packaged auto-updates follow **stable** GitHub releases unless you change updater policy.

## Tags

- One **annotated** Git tag per release: **`v` + version**, e.g. `v1.0.0`, `v1.0.1`, `v2.0.0` (matches the [Build/Release workflow](workflows/release.yml) filter `v*`).
- Create the tag **on the commit** that already contains the bumped `package.json` version for that release.
- Tags are **immutable**: to replace a broken release, delete the remote tag and the GitHub Release, then re-create the tag on the correct commit (force-push tag only when intentional).

## GitHub Releases

- Pushing a `v*` tag runs **Build/Release** after **lint + tests** succeed; **electron-builder** publishes installers and update metadata to that GitHub Release.
- Prefer **full** releases for GA; use GitHub’s **“Set as the latest release”** / non–pre-release for stable channels.
- Release notes: summarize changes since the previous tag (Spring Boot publishes detailed notes per version; we can grow into that over time).

## Typical flows

### GA minor/major from `main`

1. On `main`, set `package.json` / `package-lock.json` version to the new release (e.g. `1.1.0`).
2. Commit (e.g. `release: 1.1.0`).
3. `git tag -a v1.1.0 -m "API Workbench 1.1.0"`
4. `git push origin main && git push origin v1.1.0`

### Patch on a maintenance line (`1.0.x`)

1. Branch or checkout `1.0.x` (create from the last `1.0.z` tag if it does not exist yet).
2. Cherry-pick or commit fixes; bump version to `1.0.4`.
3. Commit, tag `v1.0.4`, push branch and tag.

### Starting maintenance line after `1.0.0`

When `main` moves to `1.1.0` but you still need patch releases for `1.0`:

```bash
git checkout -b 1.0.x v1.0.0   # or from last 1.0.z tag
git push -u origin 1.0.x
```

Then apply patches and tags on `1.0.x` as above.

## Checks

- **[CI](workflows/ci.yml)** runs on `main` (and `*.*.x` maintenance branches).
- **Releases** run only if that same check suite passes inside the [release workflow](workflows/release.yml).
