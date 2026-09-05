# Pi Dashboard abilities

## Core workspace

- Stream conversations through the active Pi runtime and retain session history.
- Browse project files and edit text files with syntax highlighting.
- Inspect Git state for the active workspace.
- Use bundled skills and reviewed plugin tools.
- Create and switch projects under the configured projects root.

## Optional tools

- Open a local PowerShell, Command Prompt, Bash, or other configured shell through the embedded terminal.
- Preview workspace HTML files or a local development server at desktop, tablet, and mobile sizes.
- Configure private remote access through Tailscale Serve and Dashboard authentication.
- Select Basic, Developer, Business, or custom feature/provider settings.

## Background workers

The Workers screen supports Sub-PI, Antigravity CLI, Codex CLI, and Claude CLI when installed, authenticated, and enabled.

- Research, Review, and Implement permission modes
- A durable single-job execution queue with visible queue positions
- Cancellation and timeout cleanup for the owned process tree
- Task recovery after UI/backend restart without automatic replay of interrupted work
- Bounded results, run history, and per-run Git text changes
- Native Codex continuation when a recorded thread is available
- Clearly labeled saved-handoff continuation for providers without a verified native session
- Editable routing and provider rules under `~/.pi-dashboard/workers/`

Sub-PI supports an enforceable 1-30 turn limit. All providers support a 1-30 minute Dashboard deadline and a 4-64 KB displayed result limit.
