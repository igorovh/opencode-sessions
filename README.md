# opencode-assistant

Lets any [OpenCode](https://opencode.ai) V2 session hand work to other sessions and hear back. Every top-level
session gets tools to list, search, read, start, prompt, open and close other sessions. When a session finishes work
you handed it, only your session is notified, so you can run one coordinating session per repository, or none.

> Supports OpenCode V2 only (built against `@opencode/plugin` 2.0.26). V1 is not supported.

<p align="center">
  <img src="docs/demo.gif" alt="Asking for a status, starting a session in a new tab, a clickable notification when it finishes, and closing the tab" width="1000">
</p>

The demo was recorded with the earlier dedicated Assistant agent. The flow is the same in any session now: a
status question answered from two sessions, a new session started in another repository that opens as a tab right
away, a clickable notification when that session finishes, and closing its tab.

## What it does

- **Answers "how are we doing with X?"** from the recent conversations of your other sessions.
- **Hands work out.** A session sends a prompt to an existing session or starts a new one, then returns at once. It
  never waits or polls.
- **Reports back to the sender only.** If session X hands work to session Y, reports from Y go to X and nowhere else.
  Each report is a row you can click to open Y, and it starts a new turn in X so X can continue.
- **Manages tabs.** New sessions open as tabs, the tools reopen the tab of an existing session on request, and close
  a tab once you say the thread is done.
- **Links sessions.** Session IDs in fenced ```` ```session ```` blocks render as clickable links.

The tools never answer permissions or questions on your behalf.

## Requirements

- OpenCode V2, 2.0.26 or newer.

## Install

Install the plugin from GitHub with the OpenCode CLI:

```sh
opencode plugin add github:igorovh/opencode-assistant
```

This adds the plugin to the global `plugins` array in `~/.config/opencode/opencode.jsonc`. One entry loads both
parts: the server part (the tools and the reports) and the TUI part (tabs, session links and `/go`). Restart
OpenCode afterwards.

You can also add the entry to the config yourself:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:igorovh/opencode-assistant"]
}
```

Update or remove it later:

```sh
opencode plugin update github:igorovh/opencode-assistant
opencode plugin remove github:igorovh/opencode-assistant
```

## Getting started

Ask any session things like "how are we doing with the checkout launch?" or "start a session in ~/code/app that
fixes the flaky login test". When that session finishes, the session you asked gets the report.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "github:igorovh/opencode-assistant",
      "options": { "model": "anthropic/claude-opus-5-5", "variant": "medium" }
    }
  ]
}
```

- `model`: the model `session_new` uses unless you name another, as `"providerID/modelID"`. Without it, new
  sessions use your default model.
- `variant`: the model variant to use with `model`.

## Tools

The tools work only in top-level sessions (tabs). Subagents get an error, because reports sent to them would never
reach you.

| Tool | What it does |
|---|---|
| `session_list` | Lists sessions across all projects with status: running, idle, or waiting for a permission or an answer. Marks sessions you handed work to or watch. |
| `session_search` | Searches titles, prompts and replies of recent sessions for a topic. |
| `session_read` | Reads the recent conversation of one session. |
| `session_send` | Sends a prompt to a session and returns at once. Your session is notified when that turn ends. |
| `session_new` | Starts a new session in a directory with a prompt and opens it as a tab. Your session is notified when its first turn ends. |
| `session_open` | Opens an existing session as a tab, or activates its tab if it is already open. Does not change watching. |
| `session_close` | Closes a session's tab in every open TUI and stops watching it. The session and its history stay. |
| `session_watch` / `session_unwatch` | Starts or stops watching every turn of a session, without sending it anything. |

Details:

- `session_new` switches to the new tab by default. Pass `focus: false` to add the tab in the background, or
  `open: false` to skip the tab. The result says what the TUI did (for example `TUI: opened and focused.`), or that no TUI
  confirmed it. Each TUI also shows a short toast when it opens a tab.
- `session_new` and `session_send` accept an optional `model` (`"providerID/modelID"`) and `variant` (for example
  `"medium"`; requires `model`). `session_new` creates the session on that model. `session_send` switches the
  session's model before sending, and the switch stays for later turns. Without `model`, the default model is used.
- `session_open` switches to the tab by default; pass `focus: false` to add it in the background. Its result
  reports `opened and focused`, `opened in background`, `already open`, `already open, focused` or
  `already open and active`, or that no TUI confirmed it.
- `session_close` refuses while the session is running or waiting for a permission or an answer.
- A session has one explicit watcher. `session_watch` from another session replaces it, and `session_unwatch` only
  removes your own watch.

## Reports

Where a report goes:

- **A turn another session started** (`session_send`, `session_new`): finished, failed, interrupted, and waiting for
  a permission or an answer all go to that session only. Each prompt carries `metadata.assistant.from` with the
  sender's ID, and the plugin reads it from the turn that produced the event.
- **Any other turn of a session you watch** (`session_watch`): the same events go to the watching session.
- **Everything else:** nowhere. Turns you start yourself in a tab notify no one, unless another session watches it.

A turn is everything after the session's previous `idle` message. Limitations:

- If you type in a tab while another session's prompt waits in the same turn, the whole turn counts as that
  session's and reports to it.
- The plugin pages back through the turn up to 5000 messages, so only a turn longer than that does not report.

How reports arrive:

- Each one is a `session.synthetic` message in the receiving session. It wakes that session's agent and stays in the
  chat as a clickable row. It uses `delivery: "queue"`, so it never interrupts a running turn.
- Events that arrive within 2 s go into one message. While the receiving session is working, events keep collecting
  and are sent as one message when it is idle. Repeated identical events are dropped.

Run `/go` (alias `/inbox`) in a session to pick one of the sessions that reported back to it.

## How tabs work

Tabs belong to the TUI, so the server plugin asks the TUI plugin to open or close them through RPC events. Each TUI
answers through the `ack` RPC method. When session tabs are disabled, opening a tab navigates to the session instead.

It works together with [opencode-better-tabs](https://github.com/igorovh/opencode-better-tabs). That plugin only
draws and reorders the built-in tabs, so new tabs appear in their repository group. A tab added in the background to
a collapsed group stays hidden until you open the group.

## Limitations

- A TUI that is not running when a tab event is sent misses it. The tool result then says no TUI confirmed it.
- Tabs, session links and `/go` need the plugin in the global config. A plugin added only to a project's
  `opencode.jsonc` is not loaded by TUIs started in other directories.
- `session_search` scans only recent sessions (40 by default, 150 at most) and their recent messages.
- The plugin talks to the local OpenCode service through its HTTP API, so the service must be running (it is
  whenever the TUI is).

## Development

Requires [Bun](https://bun.sh).

```sh
git clone https://github.com/igorovh/opencode-assistant.git
cd opencode-assistant
bun install
bun run typecheck
```

To run your checkout instead of the published plugin, put its path in `plugins` and restart OpenCode. After that,
OpenCode reloads the plugin whenever a file changes.

```jsonc
{
  "plugins": ["/path/to/opencode-assistant"]
}
```

## License

[MIT](LICENSE)
