import type { Plugin } from "@opencode/plugin"
import type { SessionInfo } from "@opencode/client"
import { stat } from "node:fs/promises"
import path from "node:path"
import { api } from "./api.ts"
import { attention, getSession, listSessions, messages, running } from "./sessions.ts"
import { promptMetadata, type State } from "./state.ts"
import { ago, clamp, messageText, oneLine, title, toolNames, truncate } from "./text.ts"

type Context = Plugin.Context
type ToolContext = {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
}

const SEARCH_CONCURRENCY = 8

interface ToolDef {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: any, context: ToolContext): Promise<string>
}

const LINK_HINT = 'Reference sessions to the user with a fenced ```session block containing the session ID.'

function link(session: SessionInfo): string {
  return `"${title(session)}" (${session.id}) in ${session.location.directory}`
}

interface ModelChoice {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

const MODEL_PROPERTIES = {
  model: {
    type: "string",
    description: 'Model as "providerID/modelID", e.g. "anthropic/claude-opus-5-5". Omit to keep the default.',
  },
  variant: {
    type: "string",
    description: 'Model variant, e.g. "low", "medium", "high", "xhigh" or "max". Requires model.',
  },
}

export function parseModel(model: string | undefined, variant: string | undefined): ModelChoice | undefined {
  const trimmedVariant = variant?.trim() || undefined
  if (model === undefined) {
    if (trimmedVariant) throw new Error(`variant "${trimmedVariant}" needs a model, e.g. "anthropic/claude-opus-5-5".`)
    return undefined
  }
  const value = model.trim()
  const slash = value.indexOf("/")
  const providerID = value.slice(0, slash)
  const id = value.slice(slash + 1)
  if (slash <= 0 || !id || /\s/.test(value)) {
    throw new Error(`Invalid model "${model}". Use "providerID/modelID", e.g. "anthropic/claude-opus-5-5".`)
  }
  return { providerID, id, ...(trimmedVariant ? { variant: trimmedVariant } : {}) }
}

function modelHint(options: Context["options"]): string {
  const model = typeof options.model === "string" ? options.model.trim() : ""
  const variant = typeof options.variant === "string" ? options.variant.trim() : ""
  if (!model) return "Pass model/variant only when the user names one; otherwise the project default is used."
  return `Unless the user names a model, use model "${model}"${variant ? ` with variant "${variant}"` : ""}.`
}

function describeModel(model: ModelChoice | undefined): string {
  if (!model) return ""
  return ` on ${model.providerID}/${model.id}${model.variant ? ` (${model.variant})` : ""}`
}

/** Tab requests resolve to what the connected TUIs reported doing; empty when none answered in time. */
export interface Tabs {
  open(sessionID: string, focus: boolean): Promise<string[]>
  close(sessionID: string): Promise<string[]>
}

const NO_TUI =
  "No TUI confirmed it. The opencode-sessions plugin is probably not loaded in the TUI: add it to the global " +
  "config (opencode plugin add github:igorovh/opencode-sessions) and restart the TUI."

function tabReport(results: string[]): string {
  return results.length > 0 ? `TUI: ${results.join(", ")}.` : NO_TUI
}

export type Scope = "all" | "project"

export function parseScope(value: unknown): Scope {
  return value === "project" ? "project" : "all"
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function requireDirectory(directory: string): Promise<string> {
  if (!path.isAbsolute(directory)) throw new Error(`Directory must be an absolute path: ${directory}`)
  const resolved = path.resolve(directory)
  const info = await stat(resolved).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`)
  return resolved
}

export function buildTools(ctx: Context, state: State, tabs: Tabs): ToolDef[] {
  const scope = parseScope(ctx.options.scope)

  // With scope "project", callers only see sessions of their own project.
  async function visible(context: ToolContext): Promise<(session: SessionInfo) => boolean> {
    if (scope === "all") return () => true
    const caller = await getSession(context.sessionID)
    if (!caller) throw new Error(`Session not found: ${context.sessionID}.`)
    return (session) => session.projectID === caller.projectID
  }

  async function requireSession(sessionID: string, context: ToolContext): Promise<SessionInfo> {
    const session = await getSession(sessionID)
    if (!session || !(await visible(context))(session)) {
      throw new Error(`Session not found: ${sessionID}. Find the right ID with session_list or session_search.`)
    }
    return session
  }

  // Another session's agent may edit files in its directory, so starting work there needs the caller's edit
  // permission. This keeps read-only agents such as plan from editing through another session.
  async function assertDrive(context: ToolContext, directory: string, metadata: Record<string, unknown>) {
    await ctx.permission.assert({
      sessionID: context.sessionID,
      agent: context.agent,
      action: "edit",
      resources: [`${directory.replaceAll("\\", "/").replace(/\/$/, "")}/*`],
      save: ["*"],
      metadata,
      source: { type: "tool", messageID: context.messageID, id: context.id },
    } as Parameters<Context["permission"]["assert"]>[0])
  }

  const sessions: ToolDef = {
    name: "session_list",
    description:
      "List the user's OpenCode sessions (tabs), newest activity first. Shows title, ID, " +
      "directory, whether it is running, idle or waiting for the user (permission/question), and whether you watch it. " +
      LINK_HINT,
    input: {
      type: "object",
      properties: {
        search: { type: "string", description: "Filter by text in the session title." },
        directory: { type: "string", description: "Only sessions in this absolute directory." },
        limit: { type: "number", description: "Maximum sessions to return (default 30)." },
        watchedOnly: { type: "boolean", description: "Only sessions you are watching." },
      },
      additionalProperties: false,
    },
    async execute(input: { search?: string; directory?: string; limit?: number; watchedOnly?: boolean }, context) {
      const client = await api()
      const [list, active, watches, inScope] = await Promise.all([
        listSessions({ limit: clamp(input.limit, 30, 1, 200), search: input.search, directory: input.directory }),
        running(),
        state.watches(),
        visible(context),
      ])
      const own = watches.filter((watch) => watch.notify === context.sessionID)
      const watched = new Map(own.map((watch) => [watch.sessionID, watch]))
      const filtered = list.filter(
        (session) =>
          session.id !== context.sessionID && inScope(session) && (!input.watchedOnly || watched.has(session.id)),
      )
      if (filtered.length === 0) return "No matching sessions."
      const lines = await Promise.all(
        filtered.map(async (session) => {
          const isRunning = active.has(session.id)
          const waiting = isRunning ? await attention(client, session.id) : undefined
          const needs = [
            ...(waiting?.permissions.map((p) => `permission: ${p.action} ${p.resources.join(", ")}`) ?? []),
            ...(waiting?.forms.map((f) => `question: ${f.title}`) ?? []),
          ]
          const status = needs.length > 0 ? `WAITING (${needs.join("; ")})` : isRunning ? "running" : "idle"
          const watch = watched.get(session.id)
          return [
            `- ${link(session)}`,
            `  status: ${status} · updated ${ago(session.time.updated)}` +
              (session.outcome ? ` · last outcome: ${session.outcome}` : "") +
              (watch
                ? ` · ${watch.explicit ? "watched by you" : "your task"}${watch.note ? ` (${watch.note})` : ""}`
                : ""),
          ].join("\n")
        }),
      )
      return lines.join("\n")
    },
  }

  const read: ToolDef = {
    name: "session_read",
    description:
      "Read the recent conversation of another session: user prompts, assistant replies and tool names. " +
      "Use it to answer 'how are we doing with X' after finding the session.",
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string" },
        limit: { type: "number", description: "Number of most recent messages (default 20, max 200)." },
        maxChars: { type: "number", description: "Max characters per message (default 1500)." },
      },
      required: ["sessionID"],
      additionalProperties: false,
    },
    async execute(input: { sessionID: string; limit?: number; maxChars?: number }, context) {
      const client = await api()
      const session = await requireSession(input.sessionID, context)
      const [history, active, waiting] = await Promise.all([
        messages(session.id, clamp(input.limit, 20, 1, 200)),
        running(),
        attention(client, session.id),
      ])
      const max = clamp(input.maxChars, 1500, 100, 20000)
      const header = [
        `Session ${link(session)}`,
        `status: ${active.has(session.id) ? "running" : "idle"}` +
          (session.outcome ? ` · last outcome: ${session.outcome}` : "") +
          ` · updated ${ago(session.time.updated)}`,
        ...waiting.permissions.map((p) => `WAITING for permission: ${p.action} ${p.resources.join(", ")}`),
        ...waiting.forms.map((f) => `WAITING for answer: ${f.title}`),
      ]
      const body = history.flatMap((message) => {
        const text = messageText(message)
        const tools = toolNames(message)
        if (!text && tools.length === 0) return []
        const role = message.type === "assistant" ? "assistant" : message.type
        const toolLine = tools.length > 0 ? `\n  [tools: ${tools.join(", ")}]` : ""
        return [`### ${role}\n${truncate(text ?? "", max)}${toolLine}`]
      })
      return [...header, "", ...body].join("\n")
    },
  }

  const search: ToolDef = {
    name: "session_search",
    description:
      "Search the text of recent sessions (titles, prompts and replies) for a topic, e.g. a feature, file or bug. " +
      "Returns matching sessions with snippets. " +
      LINK_HINT,
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for; every word must appear in a message." },
        sessions: { type: "number", description: "How many recent sessions to scan (default 40, max 150)." },
        messagesPerSession: {
          type: "number",
          description: "Recent messages scanned per session (default 150, max 500).",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input: { query: string; sessions?: number; messagesPerSession?: number }, context) {
      const words = input.query.toLowerCase().split(/\s+/).filter(Boolean)
      if (words.length === 0) return "Empty query."
      const matches = (text: string) => {
        const lower = text.toLowerCase()
        return words.every((word) => lower.includes(word))
      }
      const perSession = clamp(input.messagesPerSession, 150, 1, 500)
      const [all, inScope] = await Promise.all([
        listSessions({ limit: clamp(input.sessions, 40, 1, 150) }),
        visible(context),
      ])
      const list = all.filter((session) => session.id !== context.sessionID && inScope(session))
      const results = await mapLimit(list, SEARCH_CONCURRENCY, async (session) => {
        const snippets: string[] = []
        if (matches(title(session))) snippets.push(`title: ${title(session)}`)
        const history = await messages(session.id, perSession).catch(() => [])
        for (const message of history) {
          const text = messageText(message)
          if (!text || !matches(text)) continue
          const lower = text.toLowerCase()
          const at = Math.max(0, lower.indexOf(words[0]!) - 80)
          snippets.push(`${message.type}: …${oneLine(text.slice(at, at + 300), 240)}`)
        }
        return { session, snippets }
      })
      const hits = results.filter((result) => result.snippets.length > 0)
      if (hits.length === 0) return `No matches for "${input.query}" in the ${list.length} most recent sessions.`
      return hits
        .slice(0, 15)
        .map(
          ({ session, snippets }) =>
            `- ${link(session)} · updated ${ago(session.time.updated)} · ${snippets.length} hit(s)\n` +
            snippets
              .slice(-4)
              .map((snippet) => `  ${snippet}`)
              .join("\n"),
        )
        .join("\n")
    },
  }

  const send: ToolDef = {
    name: "session_send",
    description:
      "Send a prompt to another session so its agent does the work, then return immediately. Only your session " +
      "is notified, in a new turn, when the turn you started finishes, fails or needs the user. Turns the user " +
      "starts in that tab do not notify you. Write a self-contained prompt. Do not wait, poll or re-read the " +
      "session after sending. Optional model/variant switch the session's model before the prompt; the switch " +
      "stays for later turns and, if the session is busy, also applies to its current turn.",
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string" },
        text: { type: "string", description: "The prompt, written as the user would write it." },
        delivery: {
          type: "string",
          enum: ["queue", "steer"],
          description: "queue (default) waits for the current turn; steer interrupts it.",
        },
        note: { type: "string", description: "Short reminder of what was requested, kept with the watch." },
        ...MODEL_PROPERTIES,
      },
      required: ["sessionID", "text"],
      additionalProperties: false,
    },
    async execute(
      input: {
        sessionID: string
        text: string
        delivery?: "queue" | "steer"
        note?: string
        model?: string
        variant?: string
      },
      context,
    ) {
      const model = parseModel(input.model, input.variant)
      if (input.sessionID === context.sessionID) throw new Error("Cannot send a prompt to your own session.")
      const session = await requireSession(input.sessionID, context)
      await assertDrive(context, session.location.directory, { tool: "session_send", sessionID: session.id })
      if (model) await ctx.session.switchModel({ sessionID: session.id, model })
      await ctx.session.prompt({
        sessionID: session.id,
        text: input.text,
        delivery: input.delivery ?? "queue",
        metadata: promptMetadata(context.sessionID),
      })
      const existing = await state.watch(session.id)
      // Another session's explicit watch stays; this turn still reports here through the prompt metadata.
      if (!existing?.explicit || existing.notify === context.sessionID) {
        await state.addWatch({
          sessionID: session.id,
          notify: context.sessionID,
          since: Date.now(),
          note: input.note ?? existing?.note,
          explicit: existing?.explicit,
        })
      }
      return (
        `Sent to ${link(session)}${describeModel(model)}. ` +
        "Your session will be notified when this turn finishes or needs the user."
      )
    },
  }

  const create: ToolDef = {
    name: "session_new",
    description:
      "Start a new session in a directory with an initial prompt, then return immediately. Only your session is " +
      "notified, in a new turn, when its first turn finishes, fails or needs the user. Unless open is false, it " +
      "opens as a tab in the user's TUI. With focus (default true) that tab becomes the active one; with focus " +
      "false it is added in the background. The result says whether a TUI confirmed it. " +
      modelHint(ctx.options),
    input: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Absolute project directory." },
        text: { type: "string", description: "The initial prompt." },
        title: { type: "string" },
        agent: { type: "string", description: "Agent ID, e.g. build or plan. Defaults to the project default." },
        note: { type: "string" },
        open: { type: "boolean", description: "Open the session as a tab (default true)." },
        focus: { type: "boolean", description: "Switch to the new tab (default true). Needs open." },
        ...MODEL_PROPERTIES,
      },
      required: ["directory", "text"],
      additionalProperties: false,
    },
    async execute(
      input: {
        directory: string
        text: string
        title?: string
        agent?: string
        note?: string
        open?: boolean
        focus?: boolean
        model?: string
        variant?: string
      },
      context,
    ) {
      const model = parseModel(input.model, input.variant)
      const directory = await requireDirectory(input.directory)
      await assertDrive(context, directory, { tool: "session_new", directory })
      const client = await api()
      const session = await client.session.create({
        location: { directory },
        ...(input.title ? { title: input.title } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(model ? { model } : {}),
      })
      await ctx.session.prompt({ sessionID: session.id, text: input.text, metadata: promptMetadata(context.sessionID) })
      await state.addWatch({ sessionID: session.id, notify: context.sessionID, since: Date.now(), note: input.note })
      const open = input.open ?? true
      const report = open ? ` ${tabReport(await tabs.open(session.id, input.focus ?? true))}` : ""
      return `Created and started ${link(session)}${describeModel(model)}. Watching it.${report}`
    },
  }

  const open: ToolDef = {
    name: "session_open",
    description:
      "Open an existing session as a tab in the user's TUI, e.g. when the user closed its tab and wants it back. " +
      "With focus (default true) the tab becomes the active one; with focus false it is added in the background. " +
      "If the tab is already open, it is only activated. Does not change watching. The result says what the TUI " +
      "did, or that no TUI confirmed it. " +
      LINK_HINT,
    input: {
      type: "object",
      properties: {
        sessionID: { type: "string" },
        focus: { type: "boolean", description: "Switch to the tab (default true)." },
      },
      required: ["sessionID"],
      additionalProperties: false,
    },
    async execute(input: { sessionID: string; focus?: boolean }, context) {
      const session = await requireSession(input.sessionID, context)
      const results = await tabs.open(session.id, input.focus ?? true)
      return `Asked the TUI to open ${link(session)}. ${tabReport(results)}`
    },
  }

  const close: ToolDef = {
    name: "session_close",
    description:
      "Close a session's tab in the user's open TUIs and stop your watch on it. The session and its history are kept. " +
      "Refuses while the session is running or waiting for a permission or an answer. Only use it after the user " +
      "confirms the thread is finished.",
    input: {
      type: "object",
      properties: { sessionID: { type: "string" } },
      required: ["sessionID"],
      additionalProperties: false,
    },
    async execute(input: { sessionID: string }, context) {
      if (input.sessionID === context.sessionID) throw new Error("Cannot close your own session.")
      const session = await requireSession(input.sessionID, context)
      const client = await api()
      const [active, waiting] = await Promise.all([running(), attention(client, session.id)])
      const needs = [
        ...waiting.permissions.map((p) => `permission: ${p.action} ${p.resources.join(", ")}`),
        ...waiting.forms.map((f) => `question: ${f.title}`),
      ]
      if (needs.length > 0) {
        throw new Error(`Not closing ${link(session)}: it is waiting for the user (${needs.join("; ")}).`)
      }
      if (active.has(session.id)) throw new Error(`Not closing ${link(session)}: it is still running.`)
      // Another session's watch stays; only the caller's own watch ends with the tab.
      const existing = await state.watch(session.id)
      const own = existing?.notify === context.sessionID
      if (own) await state.removeWatch(session.id)
      const results = await tabs.close(session.id)
      return `Closed ${link(session)}${own ? " and stopped watching it" : ""}; the session is kept. ${tabReport(results)}`
    },
  }

  const watch: ToolDef = {
    name: "session_watch",
    description:
      "Watch a session without sending it anything: your session is notified when any turn finishes (including " +
      "turns the user starts in its tab), fails or needs the user. Use it only when the user asks to follow a " +
      "session. A session has one watcher; watching it here replaces the previous one.",
    input: {
      type: "object",
      properties: { sessionID: { type: "string" }, note: { type: "string" } },
      required: ["sessionID"],
      additionalProperties: false,
    },
    async execute(input: { sessionID: string; note?: string }, context) {
      if (input.sessionID === context.sessionID) throw new Error("Cannot watch your own session.")
      const session = await requireSession(input.sessionID, context)
      await state.addWatch({
        sessionID: session.id,
        notify: context.sessionID,
        since: Date.now(),
        note: input.note,
        explicit: true,
      })
      return `Watching every turn of ${link(session)}.`
    },
  }

  const unwatch: ToolDef = {
    name: "session_unwatch",
    description: "Stop watching a session.",
    input: {
      type: "object",
      properties: { sessionID: { type: "string" } },
      required: ["sessionID"],
      additionalProperties: false,
    },
    async execute(input: { sessionID: string }, context) {
      const existing = await state.watch(input.sessionID)
      if (!existing || existing.notify !== context.sessionID) return `You are not watching ${input.sessionID}.`
      await state.removeWatch(input.sessionID)
      return `Stopped watching ${input.sessionID}.`
    },
  }

  return [sessions, read, search, send, create, open, close, watch, unwatch]
}

export async function registerTools(ctx: Context, tools: ToolDef[]) {
  return ctx.tool.transform((editor) => {
    for (const tool of tools) {
      editor.add({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        execute: async (input: unknown, context: ToolContext) => {
          // Subagent sessions are not tabs; reports sent to them would never reach the user.
          const caller = await getSession(context.sessionID)
          if (!caller) throw new Error(`${tool.name}: could not look up the calling session ${context.sessionID}.`)
          if (caller.parentID) throw new Error(`${tool.name} only works in top-level sessions, not in subagents.`)
          return { content: await tool.execute(input ?? {}, context) }
        },
      } as never)
    }
  })
}
