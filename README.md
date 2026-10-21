# opencode-assistant

A personal assistant session for [OpenCode](https://opencode.ai) V2. Keep one tab open in this directory, and the
`assistant` agent keeps track of all your other sessions: it tells you how a topic is going, hands work to other
sessions, and tells you when they finish or need you.

> Supports OpenCode V2 only (built against `@opencode/plugin` 2.0.26). V1 is not supported.

<p align="center">
  <img src="docs/demo.gif" alt="Asking for a status, starting a session in a new tab, a clickable notification when it finishes, and closing the tab" width="1000">
</p>

The demo shows, in order: a status question answered from notes and two sessions, a new session started in another
repository that opens as a tab right away, a clickable notification when that session finishes, and closing its tab.

## What it does

- **Answers "how are we doing with X?"** from your notes in `memory/` and from the recent conversations of your other
  sessions.
- **Hands work out.** It sends a prompt to an existing session or starts a new one, then returns at once. It never
  waits or polls.
- **Notifies you** in its tab when a watched session finishes or fails, or when any session waits for a permission or
  an answer. Each notification is a row you can click to open that session.
- **Manages tabs.** New sessions open as tabs, it reopens the tab of an existing session on request, and it closes
  a tab once you say the thread is done.
- **Links sessions.** Session IDs in its replies render as clickable links.

The assistant does not write code itself, and it never answers permissions or questions on your behalf.

## Requirements

- OpenCode V2, 2.0.26 or newer.

## Install

Install the plugin from GitHub with the OpenCode CLI:

```sh
opencode plugin add github:igorovh/opencode-assistant
```

This adds the plugin to the global `plugins` array in `~/.config/opencode/opencode.jsonc`. One entry loads both
parts: the server part (the `assistant` agent, its tools and the notifications) and the TUI part (tabs, session
links and `/go`). Restart OpenCode afterwards.

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

1. Pick a directory to be the assistant's home, for example `~/assistant`. Its notes go to `memory/` there. Set it
   as the `home` option (see [Options](#options)) so the agent shows up only there.
2. Start OpenCode in that directory and switch to the **Assistant** agent (`shift+tab` cycles agents).
3. Keep this tab open. Ask it things like "how are we doing with the checkout launch?" or "start a session in
   ~/code/app that fixes the flaky login test".

To open the home directory with the assistant already selected, add an `opencode.jsonc` there:

```jsonc
{ "default_agent": "assistant" }
```

`memory/` holds plain Markdown notes: `memory/index.md` lists topics, and `memory/topics/<topic>.md` holds one
topic each. The assistant reads them freely but writes only when you ask it to. If the home directory is a git
repository, add `memory/` to its `.gitignore` to keep notes private.

## Options

```jsonc
{
  "plugins": [
    {
      "package": "github:igorovh/opencode-assistant",
      "options": { "home": "~/assistant", "model": "anthropic/claude-opus-5-5", "variant": "medium" }
    }
  ]
}
```

- `model`: the model the assistant suggests for new sessions, as `"providerID/modelID"`. Without it, the assistant
  asks and otherwise uses your default model.
- `variant`: the model variant to suggest with `model`.
- `home`: the assistant's home directory. When set, the **Assistant** agent appears only there and in its
  subdirectories, instead of in every directory. Tools and notifications work the same either way.

## Tools

| Tool | What it does |
|---|---|
| `assistant_sessions` | Lists sessions across all projects with status: running, idle, or waiting for a permission or an answer. |
| `assistant_search` | Searches titles, prompts and replies of recent sessions for a topic. |
| `assistant_read` | Reads the recent conversation of one session. |
| `assistant_send` | Sends a prompt to a session and returns at once. You are notified when that turn ends. |
| `assistant_new` | Starts a new session in a directory with a prompt and opens it as a tab. You are notified when its first turn ends. |
| `assistant_open` | Opens an existing session as a tab, or activates its tab if it is already open. Does not change watching. |
| `assistant_close` | Closes a session's tab in every open TUI and stops watching it. The session and its history stay. |
| `assistant_watch` / `assistant_unwatch` | Starts or stops watching every turn of a session, without sending it anything. |

Details:

- `assistant_new` switches to the new tab by default. Pass `focus: false` to add the tab in the background, or
  `open: false` to skip the tab. The result says what the TUI did (for example `TUI: opened and focused.`), or that no TUI
  confirmed it. Each TUI also shows a short toast when it opens a tab.
- `assistant_new` and `assistant_send` accept an optional `model` (`"providerID/modelID"`) and `variant` (for example
  `"medium"`; requires `model`). `assistant_new` creates the session on that model. `assistant_send` switches the
  session's model before sending, and the switch stays for later turns. Without `model`, the default model is used.
- `assistant_open` switches to the tab by default; pass `focus: false` to add it in the background. Its result
  reports `opened and focused`, `opened in background`, `already open`, `already open, focused` or
  `already open and active`, or that no TUI confirmed it.
- `assistant_close` refuses while the session is running or waiting for a permission or an answer.

## Notifications

What triggers a notification:

- **Every session:** waiting for a permission or an answer, and failures. These always notify, so the assistant can
  remind you, even when you started the turn yourself.
- **Sessions the assistant gave work to** (`assistant_send`, `assistant_new`): also finished and interrupted, but
  only for the turn the assistant started. Turns you start yourself in that tab do not notify the assistant.
- **Sessions you asked it to watch** (`assistant_watch`): finished and interrupted for every turn, including yours.

How it tells the turns apart: the assistant sends its prompts with `metadata.assistant` on the user message. When a
turn ends, the plugin reads the session's messages since the previous `idle` message and reports the turn only if
one of them carries that mark. Limitations:

- If you type in a tab while the assistant's prompt waits in the same turn, the whole turn counts as the assistant's
  and notifies.
- Only the last 50 messages are checked, so a very long turn whose prompt is older than that does not notify.
- Watches created before this change count as "work from the assistant", not as `assistant_watch`. Ask the assistant
  to watch them again if you want every turn.

Notifications go to the assistant session that last used a tool. Each one starts an assistant turn:

- It is a `session.synthetic` message, so it wakes the assistant and stays in the chat as a clickable row.
  It uses `delivery: "queue"`, so it never interrupts a running turn.
- Events that arrive within 2 s go into one message. While the assistant is working, events keep collecting and are
  sent as one message when it is idle. Repeated identical events are dropped.
- The assistant decides whether to answer. If not, it replies exactly `NO_REPLY`, and the plugin removes that turn
  with `session.revert.stage({ files: false })` and `session.revert.commit`. Files are not touched, and the
  notification itself stays. The plugin skips this cleanup if anything else happened after the notification or if
  input is queued, because a revert would delete it.

Run `/go` (alias `/inbox`) in any TUI to pick a session from the recent notifications.

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
- `assistant_search` scans only recent sessions (40 by default, 150 at most) and their recent messages.
- Notifications go to one assistant session: the one that last used a tool. Sessions that use the `assistant` agent
  never notify.
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

The agent's instructions are in `src/agent.md`.

## License

[MIT](LICENSE)
