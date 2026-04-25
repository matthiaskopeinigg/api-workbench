# Changelog

All notable changes to this project will be documented in this file.

## [1.1.3] - 2026-04-25

### Fixed
- **Updater**: Removed the redundant "Restart & install" button that briefly appeared during automated updates. The UI now shows "Restarting to install update..." to reflect the automated flow.

## [1.1.2] - 2026-04-25

### Fixed
- **WebSocket**: Resolved unit test failures in `WebSocketComponent` by correctly mocking `EnvironmentsService`.

## [1.1.1] - 2026-04-25

### Added
- **WebSocket / SSE**:
    - Full Environment variable support (`{{variable}}`) in URL, Headers, and Message Body.
    - Support for dynamic placeholders (`$uuid`, `$timestamp`, `$isoDate`, etc.).
    - Environment selection dropdown added to the tab header.
    - Replaced message draft `textarea` with a full `CodeEditor` supporting syntax highlighting and autocomplete.
- **UI/UX**:
    - Standardized dropdown button widths (Auth Type, Environment Selection) to prevent stretching.
    - Improved layout consistency between Request and WebSocket tabs.

### Fixed
- **SSE**: Fixed missing variable resolution in SSE mode.
- **UI**: Fixed "Inherit from parent" dropdown stretching to container width.

## [1.1.0] - 2026-04-25
- Previous release with core WebSocket and SSE functionality.
