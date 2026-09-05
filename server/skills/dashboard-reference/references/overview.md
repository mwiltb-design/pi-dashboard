# Foci / Pi Dashboard overview

This repository contains the native desktop Dashboard built with Electron, Node.js, React, and Vite. A separately deployed hosted Foci service has its own runtime constraints; use `cloud-run.md` only for questions about that deployment.

## Main screens

- **Chat:** streamed Pi conversations and model controls
- **Files:** project browser, Git state, and text editor
- **Terminal:** optional local pseudo-terminal
- **App Previewer:** responsive workspace HTML and local development-server previews
- **Sessions:** saved conversation history and session management
- **Skills & Tools:** bundled and installed agent capabilities
- **Workers:** durable bounded delegation to Sub-PI and enabled Antigravity, Codex, or Claude CLIs
- **Plugins:** reviewed local plugin UI and optional hosted modules
- **Settings:** system status, projects, remote access, feature presets, and provider selection

## Main processes

- `electron/main.cjs` starts the desktop window and chooses available local UI/backend ports.
- `server/src/index.ts` hosts the API, Pi RPC bridge, project services, sessions, plugins, terminal bridge, and a thin client for worker operations.
- `server/src/worker-supervisor-process.ts` is started on demand per project data directory. It owns the durable worker queue and provider process lifecycle independently of a browser connection.
- `ui/src/` is the React/Vite interface and proxies API/WebSocket requests to the backend.

The desktop launcher binds both services to `127.0.0.1`. Directly starting the backend without the launcher must set `HOST=127.0.0.1` when local-only binding is required.

## Feature presets

- **Basic:** core screens, Terminal, Workers, and Sub-PI
- **Developer:** Basic plus App Previewer, Antigravity, Codex, and the worker rules editor
- **Business:** Developer plus Claude and scheduled tasks
- **Custom:** any supported optional feature/provider combination

Selections are saved immediately. Enabling a service that was not loaded at startup can require a Dashboard restart; provider toggles within an already enabled Workers engine take effect without restarting. Installed CLI availability and provider authentication remain separate requirements.

## State locations

- `~/.pi-dashboard/`: preferences, remote access, global worker rules, plugins, and per-project Dashboard data
- `~/.pi-dashboard/projects/<project-key>/worker-task-records/`: durable worker tasks and run history
- `~/.pi/agent/`: Pi state and credentials unless configured otherwise
- Provider-specific user directories: external CLI credentials and native sessions
- `~/Pi-Dashboards/<project>/`: default project workspaces

## Security boundaries

- The browser does not receive the private Dashboard authentication token.
- Mutating browser requests require an allowed origin.
- Built-in file APIs validate paths against the active workspace.
- Plugin UI enablement and Pi read/write grants are separate.
- External worker CLIs run with local user permissions; workspace confinement is not an OS sandbox for every provider.
- Credentials, session files, `.env` files, and private memory must not be copied into source or release artifacts.
