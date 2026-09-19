# Changelog

This file records user-facing Foci Dashboard upgrades. Versions follow [Semantic Versioning](https://semver.org/); the project remains in alpha, so behavior may change between prereleases.

## [Unreleased]

## [1.0.0-alpha.4] - 2026-09-19

### Added

- Added a movable chat panel to the Files tab that mirrors and submits to the active main Pi session through the existing shared chat connection.
- Added visible, removable current-file context with workspace-relative path, cursor position, and selected text capped at 12,000 characters.
- Added responsive panel positioning, viewport clamping, Escape-to-minimize, focus restoration, and a reset-position control.

### Changed

- Extracted a reusable chat composer so the main Chat view and compact Files panel share send, stop, connection, and keyboard behavior.
- Preserved panel state across navigation and reset draft-only context when the active chat session changes.

## [1.0.0-alpha.3] - 2026-09-17

### Changed

- Completed the first pass of the Foci Dashboard user-facing rebrand:
  - Updated window titles, browser document title, sidebar branding, sign-in eyebrow, and conversation header.
  - Updated remote access description, desktop shortcut metadata, launcher banners, onboarding defaults, `.env.example`, and GPL notice text.
  - Updated user-facing documentation, skills definitions, and worker prompt headers to Foci Dashboard while retaining Pi as the AI persona.
  - Preserved existing data paths (`~/.pi-dashboard`, `~/Pi-Dashboards`, `~/.pi/agent`), `PI_DASHBOARD_*` environment variables, API schemas, and plugin IDs.
- Added reusable Foci logo and favicon assets to replace the temporary Vite favicon and `π` product marks while preserving `π` for Sub-Pi worker/persona badges.

## [1.0.0-alpha.2] - 2026-09-16

### Added

- Added an **Upload files** action beside **New file** in the Files tab.
- Added multi-file uploads to each active workspace's `uploaded/` folder.
- Added collision-safe filenames such as `report (2).pdf` instead of overwriting existing files.
- Added read-only PDF previews in the Files viewer.
- Added upload and PDF validation tests.

### Security and reliability

- Streams uploads with a 25 MiB per-file limit and removes partial temporary files after failures.
- Rejects unsafe paths, Windows reserved names, and sensitive credential filenames.
- Verifies that the upload destination remains inside the active workspace.
- Preserves unsaved editor changes when an upload finishes.

## [1.0.0-alpha.1] - 2026-09-15

### Added

- Initial desktop alpha with Pi chat, project files, sessions, skills, plugins, optional terminal and previewer, remote access, and bounded multi-provider workers.
- Durable worker supervision, serialized task execution, cancellation, recovery, continuation, and bounded change previews.

[Unreleased]: https://github.com/mwiltb-design/pi-dashboard/compare/v1.0.0-alpha.4...HEAD
[1.0.0-alpha.4]: https://github.com/mwiltb-design/pi-dashboard/compare/v1.0.0-alpha.3...v1.0.0-alpha.4
[1.0.0-alpha.3]: https://github.com/mwiltb-design/pi-dashboard/compare/v1.0.0-alpha.2...v1.0.0-alpha.3
[1.0.0-alpha.2]: https://github.com/mwiltb-design/pi-dashboard/compare/1f10fd6...v1.0.0-alpha.2
[1.0.0-alpha.1]: https://github.com/mwiltb-design/pi-dashboard/tree/1f10fd6
