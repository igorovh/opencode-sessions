// @bun
// src/tui.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { BoxRenderable, TextRenderable } from "@opentui/core";

// src/rpc.ts
import { Rpc } from "@opencode/plugin";
var openEvent = {
  schema: {
    type: "object",
    properties: { requestID: { type: "string" }, sessionID: { type: "string" }, focus: { type: "boolean" } },
    required: ["requestID", "sessionID", "focus"],
    additionalProperties: false
  }
};
var closeEvent = {
  schema: {
    type: "object",
    properties: { requestID: { type: "string" }, sessionID: { type: "string" } },
    required: ["requestID", "sessionID"],
    additionalProperties: false
  }
};
var SessionsRpc = Rpc.define({
  id: "sessions",
  methods: {
    ack: {
      input: {
        type: "object",
        properties: {
          requestID: { type: "string" },
          result: { type: "string", description: "What the TUI did, e.g. focused, opened, navigated, closed." }
        },
        required: ["requestID", "result"],
        additionalProperties: false
      },
      output: { type: "object", additionalProperties: false }
    }
  },
  events: {
    "tab.open": openEvent,
    "tab.close": closeEvent
  }
});

// src/tui.tsx
var SESSION_ID = /ses_[A-Za-z0-9]+/g;
function eventSessionID(data) {
  const value = data?.sessionID;
  return typeof value === "string" ? value : undefined;
}
function openSession(context, sessionID) {
  if (context.ui.tabs.enabled() && context.ui.tabs.focus(sessionID))
    return;
  context.ui.router.navigate({
    type: "session",
    sessionID
  });
}
function label(context, sessionID, session) {
  if (!session)
    return `\u2192 ${sessionID}`;
  const name = session.title?.trim() || sessionID;
  return `\u2192 ${name} \xB7 ${context.ui.format.path(session.location.directory)}`;
}
function sessionLink(context, sessionID) {
  const cached = context.data.session.get(sessionID);
  const text = new TextRenderable(context.renderer, {
    content: label(context, sessionID, cached),
    fg: context.theme.text.feedback.info.base,
    wrapMode: "none",
    selectable: false
  });
  text.onMouseUp = (event) => {
    if (event.button !== 0)
      return;
    openSession(context, sessionID);
  };
  text.onMouseOver = () => {
    text.fg = context.theme.text.base;
  };
  text.onMouseOut = () => {
    text.fg = context.theme.text.feedback.info.base;
  };
  if (!cached) {
    context.client.session.get({
      sessionID
    }).then((session) => {
      if (!text.isDestroyed)
        text.content = label(context, sessionID, session);
    }).catch(() => {});
  }
  return text;
}
async function showInbox(context) {
  const route = context.ui.router.current();
  if (route.type !== "session") {
    context.ui.toast.show({
      title: "Sessions",
      message: "Open a session first.",
      variant: "warning"
    });
    return;
  }
  const response = await context.client.message.list({
    sessionID: route.sessionID,
    type: "synthetic",
    limit: 50,
    order: "desc"
  });
  const options = response.data.flatMap((message) => {
    if (message.type !== "synthetic")
      return [];
    const metadata = message.metadata ?? {};
    const childID = typeof metadata.childID === "string" ? metadata.childID : undefined;
    const kind = metadata.sessions ?? metadata.assistant;
    if (!childID || typeof kind !== "string")
      return [];
    const category = new Date(message.time.created).toLocaleString();
    const events = Array.isArray(metadata.events) ? metadata.events : [];
    const batched = events.flatMap((item) => {
      const event = item;
      if (typeof event.sessionID !== "string")
        return [];
      return [{
        title: `${String(event.title ?? event.sessionID)} \xB7 ${String(event.kind)}`,
        value: event.sessionID,
        category
      }];
    });
    if (batched.length > 0)
      return batched;
    const name = typeof metadata.agent === "string" ? metadata.agent : childID;
    return [{
      title: `${name} \xB7 ${kind}`,
      value: childID,
      description: message.description,
      category
    }];
  });
  if (options.length === 0) {
    context.ui.toast.show({
      title: "Sessions",
      message: "No session reports in this session yet.",
      variant: "info"
    });
    return;
  }
  const selected = await context.ui.dialog.select({
    title: "Session reports",
    options: options.slice(0, 30)
  });
  if (selected)
    openSession(context, selected);
}
function Commands(props) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "sessions.inbox",
      title: "Session reports",
      description: "Jump to a session that reported back to the current session",
      group: "Sessions",
      palette: true,
      slash: {
        name: "go",
        aliases: ["inbox"]
      },
      run: () => {
        showInbox(props.context).catch((error) => props.context.ui.toast.show({
          title: "Sessions",
          message: String(error),
          variant: "error"
        }));
      }
    }]
  }));
  return null;
}
var tui_default = Plugin.define({
  id: "sessions",
  setup(context) {
    const unregister = context.markdown.registerCodeBlockRenderer("session", (token) => {
      const ids = [...new Set(token.text.match(SESSION_ID) ?? [])];
      if (ids.length === 0)
        return;
      const box = new BoxRenderable(context.renderer, {
        flexDirection: "column",
        width: "100%"
      });
      for (const id of ids)
        box.add(sessionLink(context, id));
      return box;
    });
    const slot = context.ui.slot({
      append: "app",
      render: () => _$createComponent(Commands, {
        context
      })
    });
    const rpc = context.client.rpc(SessionsRpc);
    const ack = (event, result) => {
      const requestID = event.data.requestID;
      if (typeof requestID !== "string")
        return;
      rpc.ack({
        requestID,
        result
      }, {
        location: {
          directory: event.location.directory
        }
      }).catch(() => {});
    };
    const stopOpen = rpc.events.on("tab.open", async (event) => {
      const sessionID = eventSessionID(event.data);
      if (!sessionID)
        return;
      const focus = event.data.focus !== false;
      await context.data.session.sync(sessionID).catch(() => {});
      const existing = context.ui.tabs.enabled() ? context.ui.tabs.list().find((tab) => tab.sessionID === sessionID) : undefined;
      let result;
      if (focus) {
        if (context.ui.tabs.focus(sessionID)) {
          result = !existing ? "opened and focused" : existing.active ? "already open and active" : "already open, focused";
        } else {
          result = "navigated (tabs disabled)";
          context.ui.router.navigate({
            type: "session",
            sessionID
          });
        }
      } else if (existing) {
        result = "already open";
      } else {
        result = context.ui.tabs.open(sessionID) ? "opened in background" : "not opened (tabs disabled)";
      }
      const name = context.data.session.get(sessionID)?.title ?? sessionID;
      context.ui.toast.show({
        title: "Sessions",
        message: `${name}: ${result}`,
        variant: "info",
        duration: 2500
      });
      ack(event, result);
    });
    const stopClose = rpc.events.on("tab.close", (event) => {
      const sessionID = eventSessionID(event.data);
      if (!sessionID)
        return;
      ack(event, context.ui.tabs.close(sessionID) ? "closed" : "no open tab");
    });
    return () => {
      stopOpen();
      stopClose();
      unregister();
      slot();
    };
  }
});
export {
  tui_default as default
};
