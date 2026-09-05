# Worker supervisor operations

Foci runs delegated CLI work through one lightweight supervisor for each project data directory. The Dashboard backend connects over an authenticated local named pipe. Closing or refreshing the UI does not cancel work; an explicit task cancellation or supervisor shutdown does. The supervisor exits after two idle minutes, and the next worker request automatically reconnects or starts it again.

## Storage and migration

- Existing `worker-tasks.json` and `worker-tasks-archive.json` files remain untouched as legacy backups after migration.
- Current records are stored individually under `worker-task-records/`, with `index.json` written last using atomic replacement and retry backoff for transient Windows file locks.
- Provider session references, run history, bounded results, and bounded per-run diffs live in the task record. Project files and provider history are never deleted when a Dashboard task is archived.
- A queued run is safe to start after supervisor recovery. A run that was starting or running is marked `interrupted` and is never replayed automatically.

## Process ownership

On Windows, the supervisor records the worker PID and creation timestamp, then terminates the full process tree with `taskkill /T` and a forced fallback. The creation timestamp is checked before termination to avoid a recycled-PID kill. Other Codex, Claude, Antigravity, Node, and Pi sessions are not targeted by executable name.

## Continuation

- Codex CLI supports native continuation with its recorded thread ID.
- Other providers currently start a new session with a structured saved handoff. The UI labels this as a new session.
- Continuations keep the original workspace, provider, and permission mode. Start a new task to change from read-only to implementation permissions.
- If a native Codex session is unavailable, the failed run remains visible and **Use saved handoff** starts a new session only after the user chooses it.

## Change tracking limits

Only dirty-file baselines and post-run Git changes are captured. Generated directories, likely credential files, and binary files are excluded. Each text diff is capped at 256 KB and the total payload is capped at 2 MB. Truncation and incomplete tracking are shown explicitly; inspect the workspace directly when warned. Non-Git workspaces currently receive an explicit incomplete-tracking warning instead of an unreliable diff.

## Measured overhead

On the Windows development machine, an idle supervisor with no provider CLI running used a 77.9 MB working set (74.8 MB private memory, 15 threads, and 0.297 seconds of cumulative CPU after roughly 10 seconds). This is a one-sample development measurement, not a cross-machine guarantee. The supervisor starts no provider process while idle and exits after two idle minutes.

## Troubleshooting

- A task stuck in `starting` or `cancelling` should be inspected before starting another supervisor. New supervisors refuse to overlap an existing named-pipe owner.
- On Windows, `connect ENOENT \\.\pipe\foci-supervisor-<hash>` should recover automatically on the next request. If it repeats, fully restart the Dashboard and inspect the project-specific supervisor configuration and activity log; do not delete task records.
- `interrupted` means the previous supervisor stopped unexpectedly. Review files and either continue from the saved handoff or start a new task.
- The supervisor exits after two idle minutes. The next worker request starts it again on demand.
- Use the Workers page for status and task IDs. Primary PI delegation also returns a task ID when its bounded wait ends.
