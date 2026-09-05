# Workers reference

Use this page for the Workers screen, delegated CLI tasks, recovery, continuation, and change previews.

## Providers and modes

The Dashboard can use Sub-PI and installed Antigravity (`agy`), Codex (`codex`), and Claude (`claude`) CLIs. A provider must be installed, authenticated, and enabled. Research and Review are read-only policy modes; Implement permits project edits.

Workers inherit the local user's process permissions. The Dashboard scopes the process working directory and prompt to the selected project, and Codex receives its supported workspace sandbox setting. Always review external CLI changes.

## Queue and supervisor

One lightweight supervisor owns each project data directory through an authenticated local named pipe. One task executes at a time and additional tasks show a queue position. The UI or backend may reconnect without cancelling supervisor-owned work.

The supervisor exits after two idle minutes. A later request automatically reconnects or starts it again. If the supervisor stops during a run, the next supervisor checks the recorded PID and creation time, cleans up the owned process tree when it can, and marks the run `interrupted`. It never silently reruns interrupted implementation work. A queued task remains eligible to run after recovery.

Task states are `queued`, `starting`, `running`, `cancelling`, `completed`, `failed`, `cancelled`, `timed-out`, and `interrupted`.

## Limits

- One executing task per project data directory
- 1-30 minute hard Dashboard deadline
- 4-64 KB displayed result cap
- 1-30 model turns for Sub-PI only
- Coalesced progress updates and bounded provider output

External CLI activity events are not model-turn limits.

## Continue and saved handoff

Continue creates another run under the same logical task and keeps the original provider, workspace, and permission mode. Codex reuses its recorded thread when native continuation is available. Other providers, or an unavailable native session, use a clearly labeled new session with a structured saved handoff. A saved handoff summarizes prior work; it is not the original conversation and does not automatically replay commands.

Start a new task if the provider, project, or permission mode must change.

## View changes

For Git workspaces, the supervisor captures dirty-file contents before each run and compares them with post-run Git changes. This can distinguish worker edits made after a file was already dirty. Likely secrets, binaries, dependencies, build output, and caches are excluded.

Text diffs are capped at 256 KB per file and 2 MB total. Truncation is labeled. Non-Git workspaces currently show an incomplete-tracking warning and must be inspected directly.

## Storage

Project-specific task records are stored below `~/.pi-dashboard/projects/<project-key>/worker-task-records/`. Worker configuration and editable routing rules are stored under `~/.pi-dashboard/workers/`. Legacy combined task files remain untouched after migration. Archiving a task does not delete project files or provider session history.
