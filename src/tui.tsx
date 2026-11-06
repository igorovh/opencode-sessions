/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import { BoxRenderable, TextRenderable, type MouseEvent } from "@opentui/core"
import type { SessionInfo } from "@opencode/client"
import { SessionsRpc } from "./rpc.ts"

type TuiContext = Plugin.Context

const SESSION_ID = /ses_[A-Za-z0-9]+/g

function eventSessionID(data: unknown): string | undefined {
  const value = (data as { sessionID?: unknown } | undefined)?.sessionID
  return typeof value === "string" ? value : undefined
}

function openSession(context: TuiContext, sessionID: string) {
  if (context.ui.tabs.enabled() && context.ui.tabs.focus(sessionID)) return
  context.ui.router.navigate({ type: "session", sessionID })
}

function label(context: TuiContext, sessionID: string, session: SessionInfo | undefined): string {
  if (!session) return `→ ${sessionID}`
  const name = session.title?.trim() || sessionID
  return `→ ${name} · ${context.ui.format.path(session.location.directory)}`
}

function sessionLink(context: TuiContext, sessionID: string): TextRenderable {
  const cached = context.data.session.get(sessionID)
  const text = new TextRenderable(context.renderer, {
    content: label(context, sessionID, cached),
    fg: context.theme.text.feedback.info.base,
    wrapMode: "none",
    selectable: false,
  })
  text.onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return
    openSession(context, sessionID)
  }
  text.onMouseOver = () => {
    text.fg = context.theme.text.base
  }
  text.onMouseOut = () => {
    text.fg = context.theme.text.feedback.info.base
  }
  if (!cached) {
    context.client.session
      .get({ sessionID })
      .then((session) => {
        if (!text.isDestroyed) text.content = label(context, sessionID, session)
      })
      .catch(() => {})
  }
  return text
}

async function showInbox(context: TuiContext) {
  const route = context.ui.router.current()
  if (route.type !== "session") {
    context.ui.toast.show({ title: "Sessions", message: "Open a session first.", variant: "warning" })
    return
  }
  const response = await context.client.message.list({
    sessionID: route.sessionID,
    type: "synthetic",
    limit: 50,
    order: "desc",
  })
  const options = response.data.flatMap((message) => {
    if (message.type !== "synthetic") return []
    const metadata = message.metadata ?? {}
    const childID = typeof metadata.childID === "string" ? metadata.childID : undefined
    // `assistant` is the key written before the rename to opencode-sessions.
    const kind = metadata.sessions ?? metadata.assistant
    if (!childID || typeof kind !== "string") return []
    const category = new Date(message.time.created).toLocaleString()
    const events = Array.isArray(metadata.events) ? metadata.events : []
    const batched = events.flatMap((item) => {
      const event = item as { sessionID?: unknown; title?: unknown; kind?: unknown }
      if (typeof event.sessionID !== "string") return []
      return [{ title: `${String(event.title ?? event.sessionID)} · ${String(event.kind)}`, value: event.sessionID, category }]
    })
    if (batched.length > 0) return batched
    const name = typeof metadata.agent === "string" ? metadata.agent : childID
    return [{ title: `${name} · ${kind}`, value: childID, description: message.description, category }]
  })
  if (options.length === 0) {
    context.ui.toast.show({ title: "Sessions", message: "No session reports in this session yet.", variant: "info" })
    return
  }
  const selected = await context.ui.dialog.select({ title: "Session reports", options: options.slice(0, 30) })
  if (selected) openSession(context, selected)
}

function Commands(props: { context: TuiContext }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "sessions.inbox",
        title: "Session reports",
        description: "Jump to a session that reported back to the current session",
        group: "Sessions",
        palette: true,
        slash: { name: "go", aliases: ["inbox"] },
        run: () => {
          showInbox(props.context).catch((error) =>
            props.context.ui.toast.show({ title: "Sessions", message: String(error), variant: "error" }),
          )
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "sessions",
  setup(context) {
    // ```session blocks in replies become clickable links to those sessions.
    const unregister = context.markdown.registerCodeBlockRenderer("session", (token) => {
      const ids = [...new Set(token.text.match(SESSION_ID) ?? [])]
      if (ids.length === 0) return undefined
      const box = new BoxRenderable(context.renderer, { flexDirection: "column", width: "100%" })
      for (const id of ids) box.add(sessionLink(context, id))
      return box
    })
    const slot = context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
    const rpc = context.client.rpc(SessionsRpc)
    // RPC methods route by location, so answer at the location of the server plugin that emitted the event.
    const ack = (event: { data: unknown; location: { directory: string } }, result: string) => {
      const requestID = (event.data as { requestID?: unknown }).requestID
      if (typeof requestID !== "string") return
      rpc.ack({ requestID, result }, { location: { directory: event.location.directory } }).catch(() => {})
    }
    const stopOpen = rpc.events.on("tab.open", async (event) => {
      const sessionID = eventSessionID(event.data)
      if (!sessionID) return
      const focus = (event.data as { focus?: unknown }).focus !== false
      // Sync first so the new tab shows the session title instead of a placeholder.
      await context.data.session.sync(sessionID).catch(() => {})
      const existing = context.ui.tabs.enabled()
        ? context.ui.tabs.list().find((tab) => tab.sessionID === sessionID)
        : undefined
      let result: string
      if (focus) {
        if (context.ui.tabs.focus(sessionID)) {
          result = !existing ? "opened and focused" : existing.active ? "already open and active" : "already open, focused"
        } else {
          result = "navigated (tabs disabled)"
          context.ui.router.navigate({ type: "session", sessionID })
        }
      } else if (existing) {
        result = "already open"
      } else {
        result = context.ui.tabs.open(sessionID) ? "opened in background" : "not opened (tabs disabled)"
      }
      const name = context.data.session.get(sessionID)?.title ?? sessionID
      context.ui.toast.show({ title: "Sessions", message: `${name}: ${result}`, variant: "info", duration: 2500 })
      ack(event, result)
    })
    const stopClose = rpc.events.on("tab.close", (event) => {
      const sessionID = eventSessionID(event.data)
      if (!sessionID) return
      ack(event, context.ui.tabs.close(sessionID) ? "closed" : "no open tab")
    })
    return () => {
      stopOpen()
      stopClose()
      unregister()
      slot()
    }
  },
})
