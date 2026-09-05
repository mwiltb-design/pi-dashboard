# Pi Dashboard input and command reference

## Chat input

| Input | Action |
| --- | --- |
| `Enter` | Send the current chat message |
| `Shift + Enter` | Insert a new line |

Buttons and tabs provide the supported Dashboard navigation. The application does not currently define global `Ctrl+K`, `Ctrl+Shift+F`, or terminal-toggle shortcuts.

## Pi commands

Slash commands are handled by the active Pi runtime and can vary with its installed version and extensions. `/login` opens the provider authentication flow used by the Dashboard. Use Pi's own `/help` output for the authoritative command list available in the current session.

## Worker controls

- **Cancel task** requests cleanup of the active worker process tree.
- **Continue** submits a follow-up using the stored provider session when supported.
- **Use saved handoff** starts a new provider session with a structured summary after native continuation fails or is unavailable.
- **View changes** loads the bounded text changes recorded for the selected run.
