import type { Plugin } from "@opencode/plugin"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client"
import { createNotifier, type Kind } from "./notifier.ts"
import { getSession, messages, rootSession } from "./sessions.ts"
import type { State } from "./state.ts"
import { messageText, truncate } from "./text.ts"

type Context = Plugin.Context

const ASSISTANT_AGENT = "assistant"

// Plugin reloads can leave an old instance subscribed; only the newest one may notify, and dedupe is shared.
const registry: { generation: number; seen: Set<string> } = ((globalThis as any).__opencodeAssistantWatcher ??= {
  generation: 0,
  seen: new Set<string>(),
})

export function startWatcher(ctx: Context, state: State): () => void {
  const controller = new AbortController()
  const generation = ++registry.generation
  const seen = registry.seen
  const live = () => !controller.signal.aborted && registry.generation === generation
  const notifier = createNotifier(ctx, live)

  const once = (key: string) => {
    if (!live() || seen.has(key)) return false
    seen.add(key)
    if (seen.size > 2000) seen.delete(seen.values().next().value!)
    return true
  }

  async function notify(session: SessionInfo, kind: Kind, detail: string, body: string) {
    const watch = await state.watch(session.id)
    const target = watch?.notify ?? (await state.home())
    if (!target || target === session.id) return
    notifier.add(target, { session, kind, detail, body })
  }

  async function lastReply(sessionID: string): Promise<string> {
    const history = await messages(sessionID, 10).catch(() => [])
    const reply = history.toReversed().find((message) => message.type === "assistant" && messageText(message))
    return reply ? messageText(reply)! : ""
  }

  async function relevant(sessionID: string) {
    const session = await rootSession(sessionID)
    if (!session || session.agent === ASSISTANT_AGENT) return
    const home = await state.home()
    if (session.id === home) return
    return session
  }

  async function isAssistant(sessionID: string) {
    if (sessionID === (await state.home())) return true
    return (await getSession(sessionID))?.agent === ASSISTANT_AGENT
  }

  async function handle(event: OpenCodeEvent) {
    switch (event.type) {
      case "permission.asked": {
        if (!once(`permission:${event.data.id}`)) return
        const session = await relevant(event.data.sessionID)
        if (!session) return
        const what = `${event.data.action} ${event.data.resources.join(", ")}`.trim()
        await notify(session, "permission", what, `Waiting for permission: ${what}`)
        return
      }
      case "form.created": {
        const form = event.data.form
        if (!once(`form:${form.id}`)) return
        const session = await relevant(form.sessionID)
        if (!session) return
        await notify(session, "question", form.title, `Waiting for the user to answer: ${form.title}`)
        return
      }
      case "session.execution.failed": {
        if (!once(event.id)) return
        const session = await relevant(event.data.sessionID)
        if (!session || session.id !== event.data.sessionID) return
        const error = event.data.error.message
        await notify(session, "failed", error, `Execution failed: ${error}`)
        return
      }
      case "session.execution.succeeded": {
        if (!once(event.id)) return
        if (await isAssistant(event.data.sessionID)) {
          await notifier.hideSilentTurn(event.data.sessionID)
          return
        }
        if (!(await state.watch(event.data.sessionID))) return
        const session = await relevant(event.data.sessionID)
        if (!session || session.id !== event.data.sessionID) return
        const reply = await lastReply(session.id)
        await notify(session, "finished", reply || "finished", truncate(reply || "(no text reply)", 4000))
        return
      }
      case "session.execution.interrupted": {
        if (!once(event.id)) return
        if (event.data.reason === "user" || event.data.reason === "superseded") return
        if (!(await state.watch(event.data.sessionID))) return
        const session = await relevant(event.data.sessionID)
        if (!session) return
        await notify(session, "interrupted", event.data.reason, `Execution interrupted: ${event.data.reason}`)
        return
      }
    }
  }

  void (async () => {
    while (live()) {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (!live()) return
          void handle(event as OpenCodeEvent).catch((error) => console.error("[assistant] event failed", error))
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("[assistant] event stream failed", error)
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  })()

  return () => {
    controller.abort()
    notifier.stop()
  }
}
