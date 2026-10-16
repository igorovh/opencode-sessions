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

`assistant_sessions`, `assistant_search`, `assistant_read`, `assistant_send`, `assistant_new`, `assistant_close`,
`assistant_watch`, `assistant_unwatch`.

`assistant_new` adds the new session as a background tab in every open TUI. It does not switch your active tab.
Pass `open: false` to skip the tab.

`assistant_close` closes a session's tab in every open TUI and stops watching it. The session and its history stay.
It refuses while the session is running or waiting for a permission or an answer.

Tabs belong to the TUI, so the server plugin asks the TUI plugin to open or close them through RPC events. A TUI that
is not running at that moment misses the event, and nothing happens when session tabs are disabled.

`assistant_new` and `assistant_send` accept optional `model` (`"providerID/modelID"`, e.g. `"anthropic/claude-opus-5-5"`)
and `variant` (e.g. `"medium"`; requires `model`). `assistant_new` creates the session on that model.
`assistant_send` switches the session's model before sending, and the switch stays for later turns.
Without `model` the default model is used, as before.

## Notifications

- Watched sessions: finished, failed, interrupted, waiting for permission or an answer.
- All other sessions: only waiting for permission or an answer, and failures.

Notifications go to the assistant session that last used a tool. The assistant never answers permissions or
questions for you.

Each notification starts an assistant turn:

- It is a `session.synthetic` message with the default `resume`, so it wakes the assistant and stays a clickable row.
  It uses `delivery: "queue"`, so it never interrupts a running turn.
- Events that arrive within 2 s go into one message. While the assistant is working, events keep collecting and are
  sent as one message when it is idle. Repeated identical events are dropped.
- The assistant decides whether to answer. If not, it replies exactly `NO_REPLY`, and the plugin deletes that turn
  with `session.revert.stage({ files: false })` and `session.revert.commit`. Files are not touched, and the
  notification itself stays. The plugin skips the cleanup if anything else happened after the notification or input
  is queued, because a revert would delete it.

## Development

```sh
cd plugin
bun install
bun run typecheck
```
