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
- **Manages tabs.** New sessions open as tabs, and it closes a tab once you say the thread is done.
- **Links sessions.** Session IDs in its replies render as clickable links.

The assistant does not write code itself, and it never answers permissions or questions on your behalf.

## Requirements

- OpenCode V2, 2.0.26 or newer.
- [Bun](https://bun.sh) to install the plugin's dependencies.

## Install

1. Clone the repository and install the plugin's dependencies:

   ```sh
   git clone https://github.com/igorovh/opencode-assistant.git
   cd opencode-assistant/plugin
   bun install
   ```

2. Add the plugin to the TUI. The TUI loads plugins only for the directory it was started in, so add the plugin to
   your global TUI config, `~/.config/opencode/cli.json`. This gives every TUI the tabs, the session links and `/go`:

   ```json
   {
     "plugins": ["/absolute/path/to/opencode-assistant/plugin"]
   }
   ```

   If `cli.json` already has a `plugins` array, add the path to it.

3. Start OpenCode in the repository directory:

   ```sh
   cd opencode-assistant
   opencode
   ```

   `opencode.jsonc` in this directory makes `assistant` the default agent and loads the server plugin (`./plugin`).
   Keep this tab open; it is the assistant's home.

## Layout

| Path | What it is |
|---|---|
| `opencode.jsonc` | Sets `assistant` as the default agent and loads `./plugin`. |
| `.opencode/agents/assistant.md` | The agent's instructions. Edit them to change how it works. |
| `memory/` | Your notes. The agent writes here only when you ask. Git ignores it, so notes stay on your machine. |
| `plugin/` | Server plugin (tools and event watcher) and TUI plugin (tabs, session links, `/go`). |

## Tools

| Tool | What it does |
|---|---|
| `assistant_sessions` | Lists sessions across all projects with status: running, idle, or waiting for a permission or an answer. |
| `assistant_search` | Searches titles, prompts and replies of recent sessions for a topic. |
| `assistant_read` | Reads the recent conversation of one session. |
| `assistant_send` | Sends a prompt to a session and returns at once. The session is watched automatically. |
| `assistant_new` | Starts a new session in a directory with a prompt and opens it as a tab. Also watched automatically. |
| `assistant_close` | Closes a session's tab in every open TUI and stops watching it. The session and its history stay. |
| `assistant_watch` / `assistant_unwatch` | Starts or stops watching a session without sending it anything. |

Details:

- `assistant_new` switches to the new tab by default. Pass `focus: false` to add the tab in the background, or
  `open: false` to skip the tab. The result says what the TUI did (for example `TUI: focused.`), or that no TUI
  confirmed it. Each TUI also shows a short toast when it opens a tab.
- `assistant_new` and `assistant_send` accept an optional `model` (`"providerID/modelID"`) and `variant` (for example
  `"medium"`; requires `model`). `assistant_new` creates the session on that model. `assistant_send` switches the
  session's model before sending, and the switch stays for later turns. Without `model`, the default model is used.
- `assistant_close` refuses while the session is running or waiting for a permission or an answer.

## Notifications

What triggers a notification:

- **Watched sessions:** finished, failed, interrupted, or waiting for a permission or an answer.
- **All other sessions:** only waiting for a permission or an answer, and failures.

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
- Tabs, session links and `/go` need the plugin in `~/.config/opencode/cli.json` (step 2 of the install).
- `assistant_search` scans only recent sessions (40 by default, 150 at most) and their recent messages.
- Notifications go to one assistant session: the one that last used a tool. Sessions that use the `assistant` agent
  never notify.
- The plugin talks to the local OpenCode service through its HTTP API, so the service must be running (it is
  whenever the TUI is).

## Development

```sh
cd plugin
bun install
bun run typecheck
```

OpenCode reloads the plugin whenever a file in `plugin/` changes.

[`demo/README.md`](demo/README.md) describes how the demo GIF was recorded.

## License

[MIT](LICENSE)
