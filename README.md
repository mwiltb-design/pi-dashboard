# Foci Dashboard

**A desktop workspace for Pi and your coding projects.** Chat with Pi, browse and edit project files, review sessions, use skills and plugins, and delegate bounded tasks to worker agents—all from one local app.

Pi Dashboard is now **Foci Dashboard**. Pi remains the assistant inside the app. Foci runs on your computer and works with your existing project folders and Pi setup.

<p align="center">
  <img src="docs/assets/preview.png" alt="Foci Dashboard showing a Pi conversation, project controls, and session details" width="100%">
</p>

[Website](https://focidashboard.dev/) · [Changelog](./CHANGELOG.md) · [Worker guide](./docs/worker-supervisor.md) · [License](./LICENSE)

## What is included

- **Chat and sessions:** streaming Pi conversations, model selection, saved history, branching, and compaction through the active Pi runtime.
- **Files and editor:** workspace browsing, uploads to the project `uploaded/` folder, read-only PDF previews, and a CodeMirror editor with Git state indicators.
- **Terminal:** an optional local pseudo-terminal powered by `node-pty`.
- **App Previewer:** responsive previews for workspace HTML files and local development servers.
- **Skills and plugins:** bundled skills plus reviewed local plugin tools and UI.
- **Experience presets:** Basic, Developer, Business, or a custom selection of optional features and worker providers.
- **Private remote access:** optional Tailscale Serve configuration with Dashboard authentication.

## Background workers

The Workers screen can delegate bounded Research, Review, or Implement tasks to:

- Sub-PI
- Google Antigravity CLI (`agy`)
- OpenAI Codex CLI (`codex`)
- Anthropic Claude CLI (`claude`)

One lightweight supervisor owns each project data directory. It runs one delegated job at a time, queues additional work, stores each task durably, survives UI/backend reconnection, and marks unexpectedly interrupted work honestly instead of replaying it. Cancellation targets only the owned process tree.

Completed tasks include bounded results, compact run history, and per-run text changes for Git workspaces. Codex can continue a recorded native CLI session. Providers without verified native continuation start a clearly labeled new session from a structured saved handoff. Turn limits are enforceable only for Sub-PI; all providers use a 1-30 minute deadline and a 4-64 KB displayed result cap.

Worker prompts and process working directories are scoped to the active project. Codex also uses its supported workspace sandbox. External CLIs still run with the permissions of the local user, so review worker changes before accepting them.

See [Worker supervisor operations](./docs/worker-supervisor.md) for storage, recovery, continuation, change-tracking limits, and troubleshooting.

## Install or run on Windows

The repository contains source for **1.0.0-alpha.4**. The latest source may be newer than the installer on the GitHub Releases page. To build a Windows installer:

1. Install [Node.js 20 or newer](https://nodejs.org/) and [Git](https://git-scm.com/).
2. In PowerShell, run:

   ```powershell
   git clone https://github.com/mwiltb-design/pi-dashboard.git
   cd pi-dashboard
   npm install
   npm run dist:windows
   ```

3. When the build finishes, run `dist\Foci-Dashboard-Setup-<version>.exe`.

The installer is not code-signed at this time, so Windows may show a SmartScreen warning. Only run an installer you built yourself or obtained from a trusted project release.

To run from a source checkout instead of installing, use `.\scripts\dev.ps1`. For macOS or Linux development, use `./scripts/dev.sh`; building the Windows installer is Windows-only.

## Upgrades and version history

The current source version is **1.0.0-alpha.4**. Recent upgrades:

| Version | Upgrade |
| --- | --- |
| `1.0.0-alpha.4` | Movable Files-tab chat panel sharing the active Pi session, with visible open-file, cursor, and selected-text context. |
| `1.0.0-alpha.3` | First-pass Foci Dashboard rebrand with updated UI branding, docs, launcher copy, and Foci logo/favicon assets. |
| `1.0.0-alpha.2` | Files-tab uploads, collision-safe `uploaded/` storage, and inline PDF viewing. |
| `1.0.0-alpha.1` | Initial desktop alpha and durable multi-provider worker supervision. |

Foci is prerelease software, so setup and features may change. Version 1.0.0-alpha.4 was tested on Windows for installation and launch, existing projects and sessions, Pi chat, worker tasks, switching models/providers, and close/reopen persistence. The detailed history is maintained in [`CHANGELOG.md`](./CHANGELOG.md). For each tested upgrade:

1. Add its user-facing changes under **Unreleased** in the changelog.
2. Assign the next semantic prerelease version and update package versions.
3. Run the production build and server tests.
4. Commit the upgrade, create a matching `v<version>` Git tag, and push the commit and tag together.

## Development checks

Requirements: Node.js 20 or newer. Optional worker-provider CLIs must be installed and authenticated separately.

```powershell
npm install
npm --prefix server test
npm run build
```

Build the Windows installer with `npm run dist:windows`.

## Repository map

```text
pi-dashboard/
|-- electron/       Electron shell and local service launcher
|-- server/         Backend API, Pi RPC bridge, worker supervisor, and bundled docs
|-- ui/             React and Vite interface
|-- packages/       Shared plugin SDK
|-- plugins/        Bundled plugins
|-- docs/           Repository operations and architecture guides
`-- scripts/        Launch and configuration scripts
```

## Local state

- `%USERPROFILE%\.pi-dashboard\` (Windows) or `~/.pi-dashboard/` (macOS/Linux): Dashboard preferences, plugins, and worker task history
- `%USERPROFILE%\.pi\agent\` (Windows) or `~/.pi/agent/` (macOS/Linux): Pi configuration and credentials
- Your selected project folders: existing project files stay where they are; installing Foci does not move them
- Provider-specific user directories: authentication and native CLI session history managed by each provider CLI

Back up important project files and settings before testing prerelease software. Archiving a Dashboard task does not delete project files or provider session history.

## License

Foci Dashboard is licensed under the [GNU General Public License v3.0](./LICENSE).
