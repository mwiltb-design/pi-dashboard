# Foci / Pi Dashboard

Foci is a privacy-focused desktop workspace for the Pi coding agent. It combines chat, project files, sessions, skills, plugins, an optional terminal and app previewer, and bounded background delegation to installed CLI workers.

[Website](https://focidashboard.dev/) | [License](./LICENSE) | [Worker supervisor guide](./docs/worker-supervisor.md)

## What is included

- **Chat and sessions:** streaming Pi conversations, model selection, saved history, branching, and compaction through the active Pi runtime.
- **Files and editor:** workspace browsing and a CodeMirror editor with Git state indicators.
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

## Quick start

Prerequisites:

- Node.js 20 or newer
- Git
- Any optional provider CLI you want to use, installed and authenticated separately

```powershell
git clone https://github.com/mwiltb-design/pi-dashboard.git
cd pi-dashboard
.\scripts\dev.ps1
```

On macOS or Linux, run `./scripts/dev.sh`.

The desktop launcher installs workspace dependencies when needed, selects available local ports, starts the backend and Vite UI, and opens Electron. Default ports are `127.0.0.1:4317` for the backend and `127.0.0.1:5173` for the UI; additional windows select the next available ports.

## Development checks

```powershell
npm --prefix server test
npm run build
```

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

- `~/.pi-dashboard/`: Dashboard preferences, project-scoped task records, worker rules, plugins, and remote-access configuration
- `~/.pi/agent/`: Pi configuration and credentials
- Provider-specific user directories: authentication and native CLI session history managed by each provider CLI
- `~/Pi-Dashboards/<ProjectName>/`: project workspaces created by the Dashboard

Legacy worker task files are preserved during migration. Archiving a Dashboard task does not delete project files or provider session history.

## License

Foci / Pi Dashboard is licensed under the [GNU General Public License v3.0](./LICENSE).
