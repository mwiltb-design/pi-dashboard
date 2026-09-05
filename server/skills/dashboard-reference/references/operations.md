# Dashboard operations and Tailscale guide

Use this document for desktop startup, ports, workspaces, state, backup, and private remote access.

## Starting the desktop application

- **Desktop shortcut:** open the installed Pi Dashboard shortcut if configured.
- **Windows source checkout:** `./scripts/dev.ps1`
- **macOS/Linux source checkout:** `./scripts/dev.sh`

The scripts install workspace dependencies when `server/node_modules` is absent and then launch Electron. Electron chooses available ports, starts the backend from `server/src/index.ts`, starts the Vite UI, and opens the window.

Default addresses:

- UI: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:4317`

Additional windows select the next available ports. The Electron launcher explicitly binds both services to localhost. When starting the backend directly, set `HOST=127.0.0.1`; its standalone fallback is not the desktop launcher's local-only configuration.

## Projects

Projects created in the Dashboard default to `~/Pi-Dashboards/<ProjectName>/` and receive starter `MEMORY.md` and `Notes.md` files. Opening an arbitrary configured workspace creates `MEMORY.md` if it is missing.

Each worker task captures its absolute workspace when submitted. Switching projects does not redirect queued or running work.

## Worker supervisor

The backend connects to one on-demand worker supervisor for each project data directory. The supervisor exits after two idle minutes and restarts automatically on the next request. Closing or refreshing the UI does not cancel an active task. Use the task's **Cancel task** action for explicit process-tree cleanup.

See `workers.md` for queueing, recovery, continuation, and change-view behavior.

## Tailscale Serve

1. Open **Settings** and find Remote Connectivity.
2. Enable Tailscale Serve, enter the exact Tailnet hostname, set a Dashboard password, and save.
3. Run the command shown by Settings. With the default UI port it has this form:

   ```powershell
   tailscale serve --bg --https=8443 http://127.0.0.1:5173
   ```

4. From another device on the same Tailnet, open `https://<hostname>:8443` and authenticate with the Dashboard password.

Useful commands:

- `tailscale serve status`
- `tailscale serve reset`

The allowed browser origin must include the exact HTTPS hostname and port. If the Dashboard selected a UI port other than 5173, use the displayed command rather than copying the example.

## Backup

Back up these locations while the Dashboard is stopped or otherwise quiescent:

- `~/.pi-dashboard/`: Dashboard configuration, task records, plugin state, and remote-access settings
- `~/.pi/agent/`: Pi state and credentials
- `~/Pi-Dashboards/`: default project workspaces
- Any provider-specific CLI directories whose sessions or credentials you intentionally need to preserve

Treat backups as sensitive. Do not commit credentials, tokens, private session records, or memory files to this repository.
