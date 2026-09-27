# Foci Dashboard abilities

## Core workspace

- Stream conversations through the active Pi runtime and retain session history.
- Browse project files and edit text files with syntax highlighting.
- Upload single or multiple files into each project's `uploaded/` directory with automatic collision-safe numbering (e.g. `report (2).pdf`).
- Preview PDF documents directly and read-only inside the Files tab.
- Access a floating, movable Pi chat panel within the Files tab that shares the active conversation and passes current-file path, cursor position, and selected-text context (up to 12,000 characters).
- Rename saved conversation sessions inline directly from the Sessions list.
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
- Native continuation for Codex CLI (thread ID) and Antigravity CLI (`--conversation` ID)
- Clearly labeled saved-handoff continuation for providers without a verified native session (Sub-PI, Claude CLI)
- Worker task continuation and status inspection directly from Chat via Pi tools (`dashboard_continue_worker_task`, `dashboard_get_worker_task`)
- Antigravity CLI model selection (`gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.1-pro`) and configurable reasoning effort (`low`, `medium`, `high`)
- Editable routing and provider rules under `~/.pi-dashboard/workers/`

Sub-PI supports an enforceable 1-30 turn limit. All providers support a 1-30 minute Dashboard deadline and a 4-64 KB displayed result limit.
