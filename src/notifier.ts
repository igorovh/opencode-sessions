import type { Plugin } from "@opencode/plugin"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { api } from "./api.ts"
import { messages, running } from "./sessions.ts"
import { escapeAttr, messageText, oneLine, title } from "./text.ts"

type Context = Plugin.Context

export type Kind = "finished" | "failed" | "interrupted" | "permission" | "question"

export interface Note {
  readonly session: SessionInfo
  readonly kind: Kind
  readonly detail: string
  readonly body: string
}

/** The assistant replies exactly this when a notification needs no answer; the plugin then hides that turn. */
export const SILENT_REPLY = "NO_REPLY"

// The TUI renders synthetic "subagent" notices as a clickable row that opens metadata.childID.
const STATE: Record<Kind, string> = {
  finished: "completed",
  failed: "error",
  interrupted: "cancelled",
  permission: "needs permission",
  question: "has a question",
}

const PRIORITY: readonly Kind[] = ["permission", "question", "failed", "interrupted", "finished"]
const BATCH_MS = 2000

function eventXml(note: Note): string {
  return (
    `<session-event sessionID="${note.session.id}" title="${escapeAttr(title(note.session))}" ` +
    `directory="${escapeAttr(note.session.location.directory)}" event="${note.kind}">\n${note.body}\n</session-event>`
  )
}

function isSilent(message: SessionMessageInfo): boolean {
  const text = messageText(message)?.trim() ?? ""
  return text.replace(/[`*_.\s]/g, "") === SILENT_REPLY.replace(/_/g, "")
}

export function createNotifier(ctx: Context, live: () => boolean) {
  const batches = new Map<string, { notes: Note[]; timer?: ReturnType<typeof setTimeout> }>()

  function add(target: string, note: Note) {
    let batch = batches.get(target)
    if (!batch) {
      batch = { notes: [] }
      batches.set(target, batch)
    }
    const duplicate = batch.notes.some(
      (other) => other.kind === note.kind && other.session.id === note.session.id && other.body === note.body,
    )
    if (!duplicate) batch.notes.push(note)
    batch.timer ??= setTimeout(() => void flush(target).catch(log), BATCH_MS)
  }

  async function flush(target: string) {
    const batch = batches.get(target)
    batches.delete(target)
    if (!batch || !live()) return
    // While the assistant works, keep collecting so its next turn gets one combined notice.
    if ((await running()).has(target)) {
      for (const note of batch.notes) add(target, note)
      return
    }
    await send(target, batch.notes)
  }

  async function send(target: string, notes: Note[]) {
    const sorted = notes.toSorted((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
    const primary = sorted[0]
    if (!primary) return
    const name = title(primary.session)
    const description =
      sorted.length === 1
        ? primary.detail
        : sorted.map((note) => `${title(note.session)}: ${note.kind}`).join(" · ")
    await ctx.session.synthetic({
      sessionID: target,
      description: oneLine(description, 200),
      text: sorted.map(eventXml).join("\n\n"),
      metadata: {
        source: "subagent",
        childID: primary.session.id,
        agent: oneLine(sorted.length === 1 ? name : `${name} +${sorted.length - 1}`, 48),
        state: STATE[primary.kind],
        assistant: primary.kind,
        events: sorted.map((note) => ({ sessionID: note.session.id, title: title(note.session), kind: note.kind })),
      },
      delivery: "queue",
    })
  }

  /** Removes a finished notification turn whose only answer was SILENT_REPLY, so the TUI shows no empty reply. */
  async function hideSilentTurn(sessionID: string) {
    if (!live()) return
    const history = await messages(sessionID, 40)
    const index = history.findLastIndex((message) => message.type === "synthetic" && message.metadata?.assistant)
    const after = history.slice(index + 1)
    const replies = after.filter((message) => message.type === "assistant")
    const last = replies.at(-1)
    if (index < 0 || !last || !isSilent(last)) return
    if (after.some((message) => message.type !== "assistant" && message.type !== "idle")) return
    if (replies.some((message) => messageText(message) && !isSilent(message))) return
    const client = await api()
    const [inbox, active] = await Promise.all([client.session.inbox.list({ sessionID }), running()])
    // Revert deletes everything after the boundary, including queued input, so only run on a quiet session.
    if (inbox.length > 0 || active.has(sessionID)) return
    await client.session.revert.stage({ sessionID, messageID: after[0]!.id, files: false })
    await client.session.revert.commit({ sessionID })
  }

  function stop() {
    for (const batch of batches.values()) if (batch.timer) clearTimeout(batch.timer)
    batches.clear()
  }

  return { add, hideSilentTurn, stop }
}

function log(error: unknown) {
  console.error("[assistant] notification failed", error)
}
