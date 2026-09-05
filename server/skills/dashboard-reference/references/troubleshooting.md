# Dashboard Troubleshooting Reference

Use this document when Dashboard behavior differs between Pi, the browser, desktop processes, or Tailscale.

## Shared Notes Loads But Manual Add Fails

If Pi can add a note but the browser cannot, Shared Notes storage and tools are probably working. Check browser iframe and CSP policy.

Known error:

```text
Blocked form submission to '' because the form's frame is sandboxed and the 'allow-forms' permission is not set.
```

Inspect:

- `app/src/components/PluginBrowser.tsx`
- `server/src/plugin-asset-policy.ts`

Both must allow forms:

```text
allow-scripts allow-forms
```

Also verify the live plugin asset response header contains:

```text
content-security-policy: sandbox allow-scripts allow-forms
```

## Plugin Backend Protocol Errors

Pi Dashboard 2.0 uses in-process hosted modules (`host-module`) for all backend and agent-connected plugins. The old Docker/socket sidecar protocol (`http-unix-v1`) is completely phased out.

All plugins with backend logic must declare:

```json
"backend": { "protocol": "host-module", "module": "server.ts" }
```

If a plugin fails validation with an invalid backend protocol, ensure its manifest uses `protocol: "host-module"` and contains a valid `server.ts` exporting a default handler object.

## Login Works Locally But Mutations Fail Remotely

Check `PI_DASHBOARD_ALLOWED_ORIGINS`. It must include the exact browser origin, including scheme and port:

```text
https://my-pc.tailnet.ts.net:8443
```

Check `DASHBOARD_ALLOWED_HOSTS` for the Tailscale hostname or configure it directly in the **Settings** tab.

## Remote Access Not Responding
1. Confirm the dashboard is running on your host computer (it must remain open for remote devices to connect).
2. Check if Tailscale Serve background proxy is active:
   ```powershell
   tailscale serve status
   ```
3. If disconnected or reset, run the copyable command from the Settings tab:
   ```powershell
   tailscale serve --bg --https=8443 http://127.0.0.1:5173
   ```

## Terminal Or Workers Missing

Verify that the features are enabled in your dashboard profile or settings. Then inspect `/api/config`. The expected primary feature list includes:

```text
chat, files, files-editor, sessions, skills, settings, plugins, terminal, workers
```

Feature and provider selections save immediately, but enabling a service that was not loaded at startup can require a Dashboard restart. A CLI provider also needs its executable installed and its own authentication completed. Use **Manage** or **Login** on the Workers screen when available.

## Worker Supervisor Pipe Is Unavailable

Typical Windows message:

```text
connect ENOENT \\.\pipe\foci-supervisor-<project-hash>
```

The supervisor normally exits after two idle minutes and the next worker request starts it again. If this message repeats after one retry:

1. Fully restart the Dashboard so the backend and supervisor client use the same installed source version.
2. Confirm the active project has not changed between requests.
3. Look for `worker-supervisor-config.json` and `worker-task-records/index.json` under that project's directory in `~/.pi-dashboard/projects/`.
4. Check Activity / Diagnostics for a supervisor startup or persistence error.
5. Do not delete task records or submit the same implementation repeatedly. Preserve the task ID and inspect existing project changes first.

The named pipe is ephemeral and should not exist while the supervisor is stopped. Its absence alone does not mean task records were lost.

## Worker Was Interrupted

`interrupted` means the supervisor ended before the run reached a trustworthy final state. The Dashboard does not replay it. Inspect project changes, then Continue with the saved provider session when available, use a saved handoff, or start a deliberate new task.

## Verification Pattern

When debugging:

1. Confirm the active UI port (`5173`) and Backend port (`4317`).
2. Verify auth status via `/api/auth/status` or the Settings tab.
3. Verify backend activity logs in the Activity / Diagnostics panel.
4. Verify the exact response headers involved.
5. Reproduce through the API before blaming the plugin UI.
