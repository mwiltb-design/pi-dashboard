# Changelog

This file records user-facing Foci / Pi Dashboard upgrades. Versions follow [Semantic Versioning](https://semver.org/); the project remains in alpha, so behavior may change between prereleases.

## [Unreleased]

Add completed, tested upgrades here before assigning the next version.

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

[Unreleased]: https://github.com/mwiltb-design/pi-dashboard/compare/v1.0.0-alpha.2...HEAD
[1.0.0-alpha.2]: https://github.com/mwiltb-design/pi-dashboard/compare/1f10fd6...v1.0.0-alpha.2
[1.0.0-alpha.1]: https://github.com/mwiltb-design/pi-dashboard/tree/1f10fd6
