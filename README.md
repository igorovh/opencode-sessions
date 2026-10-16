# opencode-assistant

A personal assistant session for OpenCode 2. Open one tab in this directory. The `assistant` agent can then:

- answer "jak stoimy z X?" from notes in `memory/` and from your other sessions,
- send prompts to other sessions and return at once,
- notify you in its tab when a watched session finishes or fails, or when any session waits for a permission or an answer.
  Click a notification to open that session.

## Layout

- `opencode.jsonc`: sets `assistant` as the default agent and loads `./plugin`.
- `.opencode/agents/assistant.md`: the agent's instructions.
- `memory/`: your notes. The agent writes here only when you ask. Git ignores it, so notes stay on your machine.
- `plugin/`: server plugin (tools and event watcher) plus TUI plugin (```` ```session ```` links, `/go`).

## Tools

`assistant_sessions`, `assistant_search`, `assistant_read`, `assistant_send`, `assistant_new`, `assistant_watch`,
`assistant_unwatch`.

`assistant_new` and `assistant_send` accept optional `model` (`"providerID/modelID"`, e.g. `"anthropic/claude-opus-5-5"`)
and `variant` (e.g. `"medium"`; requires `model`). `assistant_new` creates the session on that model.
`assistant_send` switches the session's model before sending, and the switch stays for later turns.
Without `model` the default model is used, as before.

## Notifications

- Watched sessions: finished, failed, interrupted, waiting for permission or an answer.
- All other sessions: only waiting for permission or an answer, and failures.

Notifications go to the assistant session that last used a tool. The assistant never answers permissions or
questions for you.

## Development

```sh
cd plugin
bun install
bun run typecheck
```
