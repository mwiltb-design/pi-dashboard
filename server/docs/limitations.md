# Pi Dashboard boundaries and limitations

## Models and network access

- Provider token and context limits are controlled by the selected model/runtime.
- Cloud providers and external CLI workers require their own network access and authentication.
- The Dashboard does not increase subscription quotas or provider limits.

## Files and execution

- Project browsing and built-in file operations are confined to the selected workspace.
- External worker CLIs run as local user processes. The Dashboard sets their workspace and instructions, but not every provider supplies an operating-system sandbox.
- Research and Review modes are policy boundaries passed to workers. Review all external CLI output and file changes before accepting them.
- Large, binary, generated, and likely sensitive files are excluded from worker change previews.

## Worker limits

- One delegated worker job executes at a time per project data directory; additional jobs queue.
- The Dashboard enforces a 1-30 minute job deadline and bounds retained/displayed output.
- Turn limits apply only to Sub-PI. External CLI activity counts are informational.
- Native continuation is currently verified for Codex. Other providers use a new session with a saved handoff.
- Per-run change previews require Git. Non-Git workspaces receive an explicit incomplete-tracking warning.
- Text diffs are capped at 256 KB per file and 2 MB total.
- Interrupted implementation work is never replayed automatically.

## Local state

- Dashboard state is stored under `~/.pi-dashboard/`; Pi state is normally under `~/.pi/agent/`.
- Provider credentials and native session history remain in each provider CLI's own user directory.
- Archiving a Dashboard task does not delete project files or provider history.
