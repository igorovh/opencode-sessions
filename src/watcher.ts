import type { Plugin } from "@opencode/plugin"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client"
import { createNotifier, type Kind } from "./notifier.ts"
import { getSession, messages, promptedBy, rootSession } from "./sessions.ts"
import type { State } from "./state.ts"
import { messageText, truncate } from "./text.ts"

type Context = Plugin.Context

// Plugin reloads can leave an old instance subscribed; only the newest one may notify, and dedupe is shared.
const registry: { generation: number; seen: Set<string> } = ((globalThis as any).__opencodeSessionsWatcher ??= {
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

  // Only the session that sent the current turn, or else its explicit watcher, hears back. Nobody else does.
  async function target(sessionID: string): Promise<string | undefined> {
    const watch = await state.watch(sessionID)
    const notify = (await promptedBy(sessionID)) ?? (watch?.explicit ? watch.notify : undefined)
    if (!notify || notify === sessionID) return undefined
    if (!(await getSession(notify))) {
      // The receiving session was deleted; drop its watch instead of reporting into nothing.
      if (watch?.notify === notify) await state.removeWatch(sessionID)
      return undefined
    }
    return notify
  }

  async function notify(session: SessionInfo, kind: Kind, detail: string, body: string) {
    const to = await target(session.id)
    if (to) notifier.add(to, { session, kind, detail, body })
  }

  async function lastReply(sessionID: string): Promise<string> {
    const history = await messages(sessionID, 10).catch(() => [])
    const reply = history.toReversed().find((message) => message.type === "assistant" && messageText(message))
    return reply ? messageText(reply)! : ""
  }

  async function handle(event: OpenCodeEvent) {
    switch (event.type) {
      case "permission.asked": {
        if (!once(`permission:${event.data.id}`)) return
        const session = await rootSession(event.data.sessionID)
        if (!session) return
        const what = `${event.data.action} ${event.data.resources.join(", ")}`.trim()
        await notify(session, "permission", what, `Waiting for the user's permission: ${what}`)
        return
      }
      case "form.created": {
        const form = event.data.form
        if (!once(`form:${form.id}`)) return
        const session = await rootSession(form.sessionID)
        if (!session) return
        await notify(session, "question", form.title, `Waiting for the user to answer: ${form.title}`)
        return
      }
      case "session.execution.failed": {
        if (!once(event.id)) return
        const session = await rootSession(event.data.sessionID)
        if (!session || session.id !== event.data.sessionID) return
        const error = event.data.error.message
        await notify(session, "failed", error, `Execution failed: ${error}`)
        return
      }
      case "session.execution.succeeded": {
        if (!once(event.id)) return
        const session = await rootSession(event.data.sessionID)
        if (!session || session.id !== event.data.sessionID) return
        const reply = await lastReply(session.id)
        await notify(session, "finished", reply || "finished", truncate(reply || "(no text reply)", 4000))
        return
      }
      case "session.execution.interrupted": {
        if (!once(event.id)) return
        if (event.data.reason === "user" || event.data.reason === "superseded") return
        const session = await rootSession(event.data.sessionID)
        if (!session || session.id !== event.data.sessionID) return
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
          void handle(event as OpenCodeEvent).catch((error) => console.error("[sessions] event failed", error))
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("[sessions] event stream failed", error)
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  })()

  return () => {
    controller.abort()
    notifier.stop()
  }
}
