---
name: dashboard-docs
description: Look up Pi Dashboard abilities, limitations, input controls, worker behavior, and troubleshooting guidance.
---

# Dashboard Documentation Lookup Skill

Use this skill whenever the user asks questions about how Pi-Dashboard works, what tools or abilities it has, its operational boundaries or limitations, or how to use keyboard shortcuts and slash commands.

## Documentation Structure
The concise documentation is located inside the server `docs/` directory:
- [abilities.md](../../docs/abilities.md) - Core features, capabilities, tools, and plugin options.
- [limitations.md](../../docs/limitations.md) - Context constraints, file thresholds, and isolation rules.
- [shortcuts.md](../../docs/shortcuts.md) - Verified chat input, Pi command, and worker controls.

For operational or troubleshooting detail, route through the bundled `dashboard-reference` skill. In particular, its `references/workers.md` covers the durable queue, supervisor pipe, continuation, storage, and change tracking.

## Guidelines
1. When asked about features, summarize directly and concisely from `abilities.md`.
2. When asked about limitations or boundaries, cite the relevant section from `limitations.md`.
3. Do not invent keyboard shortcuts or provider capabilities. State when behavior belongs to the installed Pi or provider CLI version.
