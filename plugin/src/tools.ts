import type { Plugin } from "@opencode/plugin"
import type { SessionInfo } from "@opencode/client"
import { api } from "./api.ts"
import { attention, getSession, listSessions, messages, running } from "./sessions.ts"
import type { State } from "./state.ts"
import { ago, messageText, oneLine, title, toolNames, truncate } from "./text.ts"

type Context = Plugin.Context
type ToolContext = { readonly sessionID: string; readonly agent: string }

interface ToolDef {
  name: string
  description: string
  input: Record<string, unknown>
  execute(input: any, context: ToolContext): Promise<string>
}

const ASSISTANT_AGENT = "assistant"

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

function parseModel(model: string | undefined, variant: string | undefined): ModelChoice | undefined {
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

function describeModel(model: ModelChoice | undefined): string {
  if (!model) return ""
  return ` on ${model.providerID}/${model.id}${model.variant ? ` (${model.variant})` : ""}`
}

async function requireSession(sessionID: string): Promise<SessionInfo> {
  const session = await getSession(sessionID)
  if (!session) throw new Error(`Session not found: ${sessionID}`)
  return session
}

export function buildTools(ctx: Context, state: State): ToolDef[] {
  // The assistant session that last used a tool becomes home, where alerts from unwatched sessions go.
  const touch = async (context: ToolContext) => {
    if (context.agent === ASSISTANT_AGENT) await state.setHome(context.sessionID)
  }

  const sessions: ToolDef = {
    name: "assistant_sessions",
    description:
      "List the user's OpenCode sessions (tabs) across all projects, newest activity first. Shows title, ID, " +
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
      await touch(context)
      const client = await api()
      const [list, active, watches] = await Promise.all([
        listSessions({ limit: input.limit ?? 30, search: input.search, directory: input.directory }),
        running(),
        state.watches(),
      ])
      const watched = new Map(watches.map((watch) => [watch.sessionID, watch]))
      const filtered = list.filter(
        (session) => session.id !== context.sessionID && (!input.watchedOnly || watched.has(session.id)),
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
              (watch ? ` · watched${watch.note ? ` (${watch.note})` : ""}` : ""),
          ].join("\n")
        }),
      )
      return lines.join("\n")
    },
  }

  const read: ToolDef = {
    name: "assistant_read",
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
      await touch(context)
      const client = await api()
      const session = await requireSession(input.sessionID)
      const [history, active, waiting] = await Promise.all([
        messages(session.id, Math.min(input.limit ?? 20, 200)),
        running(),
        attention(client, session.id),
      ])
      const max = input.maxChars ?? 1500
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
    name: "assistant_search",
    description:
      "Search the text of recent sessions (titles, prompts and replies) for a topic, e.g. a feature, file or bug. " +
      "Returns matching sessions with snippets. " +
      LINK_HINT,
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for; every word must appear in a message." },
        sessions: { type: "number", description: "How many recent sessions to scan (default 40, max 150)." },
        messagesPerSession: { type: "number", description: "Recent messages scanned per session (default 150)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input: { query: string; sessions?: number; messagesPerSession?: number }, context) {
      await touch(context)
      const words = input.query.toLowerCase().split(/\s+/).filter(Boolean)
      if (words.length === 0) return "Empty query."
      const matches = (text: string) => {
        const lower = text.toLowerCase()
        return words.every((word) => lower.includes(word))
      }
      const list = (await listSessions({ limit: Math.min(input.sessions ?? 40, 150) })).filter(
        (session) => session.id !== context.sessionID,
      )
      const results = await Promise.all(
        list.map(async (session) => {
          const snippets: string[] = []
          if (matches(title(session))) snippets.push(`title: ${title(session)}`)
          const history = await messages(session.id, input.messagesPerSession ?? 150).catch(() => [])
          for (const message of history) {
            const text = messageText(message)
            if (!text || !matches(text)) continue
            const lower = text.toLowerCase()
            const at = Math.max(0, lower.indexOf(words[0]!) - 80)
            snippets.push(`${message.type}: …${oneLine(text.slice(at, at + 300), 240)}`)
          }
          return { session, snippets }
        }),
      )
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
    name: "assistant_send",
    description:
      "Send a prompt to another session so its agent does the work, then return immediately. The session is " +
      "watched automatically and you will receive a notification when it finishes, fails or needs the user. " +
      "Do not wait or poll after sending. Optional model/variant switch the session's model before the prompt; " +
      "the switch stays for later turns and, if the session is busy, also applies to its current turn.",
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
      await touch(context)
      const model = parseModel(input.model, input.variant)
      if (input.sessionID === context.sessionID) throw new Error("Cannot send a prompt to your own session.")
      const session = await requireSession(input.sessionID)
      if (model) await ctx.session.switchModel({ sessionID: session.id, model })
      await ctx.session.prompt({ sessionID: session.id, text: input.text, delivery: input.delivery ?? "queue" })
      await state.addWatch({ sessionID: session.id, notify: context.sessionID, since: Date.now(), note: input.note })
      return (
        `Sent to ${link(session)}${describeModel(model)}. ` +
        "Watching it; a notification will arrive when it finishes or needs the user."
      )
    },
  }

  const create: ToolDef = {
    name: "assistant_new",
    description:
      "Start a new session in a directory with an initial prompt, then return immediately. The new session is " +
      "watched automatically and appears as a normal tab. Pass model/variant to choose the model; otherwise the " +
      "project default is used.",
    input: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Absolute project directory." },
        text: { type: "string", description: "The initial prompt." },
        title: { type: "string" },
        agent: { type: "string", description: "Agent ID, e.g. build or plan. Defaults to the project default." },
        note: { type: "string" },
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
        model?: string
        variant?: string
      },
      context,
    ) {
      await touch(context)
      const model = parseModel(input.model, input.variant)
      const client = await api()
      const session = await client.session.create({
        location: { directory: input.directory },
        ...(input.title ? { title: input.title } : {}),
        ...(input.agent ? { agent: input.agent } : {}),
        ...(model ? { model } : {}),
      })
      await ctx.session.prompt({ sessionID: session.id, text: input.text })
      await state.addWatch({ sessionID: session.id, notify: context.sessionID, since: Date.now(), note: input.note })
      return `Created and started ${link(session)}${describeModel(model)}. Watching it.`
    },
  }

  const watch: ToolDef = {
    name: "assistant_watch",
    description:
      "Watch a session without sending it anything: you will be notified when it finishes a turn, fails or needs " +
      "the user. Sessions that need permission or answers always notify, even unwatched.",
    input: {
      type: "object",
      properties: { sessionID: { type: "string" }, note: { type: "string" } },
      required: ["sessionID"],
      additionalProperties: false,
    },
    async execute(input: { sessionID: string; note?: string }, context) {
      await touch(context)
      const session = await requireSession(input.sessionID)
      await state.addWatch({ sessionID: session.id, notify: context.sessionID, since: Date.now(), note: input.note })
      return `Watching ${link(session)}.`
    },
  }

  const unwatch: ToolDef = {
    name: "assistant_unwatch",
    description: "Stop watching a session.",
    input: {
      type: "object",
      properties: { sessionID: { type: "string" } },
      required: ["sessionID"],
      additionalProperties: false,
    },
    async execute(input: { sessionID: string }, context) {
      await touch(context)
      await state.removeWatch(input.sessionID)
      return `Stopped watching ${input.sessionID}.`
    },
  }

  return [sessions, read, search, send, create, watch, unwatch]
}

export async function registerTools(ctx: Context, tools: ToolDef[]) {
  return ctx.tool.transform((editor) => {
    for (const tool of tools) {
      editor.add({
        name: tool.name,
        description: tool.description,
        input: tool.input,
        execute: async (input: unknown, context: ToolContext) => ({
          content: await tool.execute(input ?? {}, context),
        }),
      } as never)
    }
  })
}
