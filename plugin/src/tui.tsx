/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import { BoxRenderable, TextRenderable, type MouseEvent } from "@opentui/core"
import type { SessionInfo } from "@opencode/client"
import { AssistantRpc } from "./rpc.ts"

type TuiContext = Plugin.Context

const SESSION_ID = /ses_[A-Za-z0-9]+/g
const ASSISTANT_AGENT = "assistant"

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

async function findAssistant(context: TuiContext): Promise<SessionInfo | undefined> {
  const response = await context.client.session.list({ limit: 100, order: "desc", parentID: null })
  return response.data.find((session) => session.agent === ASSISTANT_AGENT)
}

async function showInbox(context: TuiContext) {
  const assistant = await findAssistant(context)
  if (!assistant) {
    context.ui.toast.show({ title: "Assistant", message: "No assistant session found yet.", variant: "warning" })
    return
  }
  const response = await context.client.message.list({
    sessionID: assistant.id,
    type: "synthetic",
    limit: 50,
    order: "desc",
  })
  const options = response.data.flatMap((message) => {
    if (message.type !== "synthetic") return []
    const metadata = message.metadata ?? {}
    const childID = typeof metadata.childID === "string" ? metadata.childID : undefined
    if (!childID || typeof metadata.assistant !== "string") return []
    const category = new Date(message.time.created).toLocaleString()
    const events = Array.isArray(metadata.events) ? metadata.events : []
    const batched = events.flatMap((item) => {
      const event = item as { sessionID?: unknown; title?: unknown; kind?: unknown }
      if (typeof event.sessionID !== "string") return []
      return [{ title: `${String(event.title ?? event.sessionID)} · ${String(event.kind)}`, value: event.sessionID, category }]
    })
    if (batched.length > 0) return batched
    const name = typeof metadata.agent === "string" ? metadata.agent : childID
    return [{ title: `${name} · ${metadata.assistant}`, value: childID, description: message.description, category }]
  })
  const selected = await context.ui.dialog.select({
    title: "Assistant notifications",
    options: [{ title: "Open assistant", value: assistant.id, category: "Assistant" }, ...options.slice(0, 30)],
  })
  if (selected) openSession(context, selected)
}

function Commands(props: { context: TuiContext }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "assistant.inbox",
        title: "Assistant notifications",
        description: "Jump to a session the assistant notified you about",
        group: "Assistant",
        palette: true,
        slash: { name: "go", aliases: ["inbox"] },
        run: () => {
          showInbox(props.context).catch((error) =>
            props.context.ui.toast.show({ title: "Assistant", message: String(error), variant: "error" }),
          )
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "assistant",
  setup(context) {
    // ```session blocks in assistant replies become clickable links to those sessions.
    const unregister = context.markdown.registerCodeBlockRenderer("session", (token) => {
      const ids = [...new Set(token.text.match(SESSION_ID) ?? [])]
      if (ids.length === 0) return undefined
      const box = new BoxRenderable(context.renderer, { flexDirection: "column", width: "100%" })
      for (const id of ids) box.add(sessionLink(context, id))
      return box
    })
    const slot = context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
    const rpc = context.client.rpc(AssistantRpc)
    const stopOpen = rpc.events.on("tab.open", (event) => {
      const sessionID = eventSessionID(event.data)
      if (!sessionID) return
      // Sync first so the new tab shows the session title instead of a placeholder.
      context.data.session
        .sync(sessionID)
        .catch(() => {})
        .finally(() => context.ui.tabs.open(sessionID))
    })
    const stopClose = rpc.events.on("tab.close", (event) => {
      const sessionID = eventSessionID(event.data)
      if (sessionID) context.ui.tabs.close(sessionID)
    })
    return () => {
      stopOpen()
      stopClose()
      unregister()
      slot()
    }
  },
})
