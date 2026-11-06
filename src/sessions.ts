import type { OpenCodeClient, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { api } from "./api.ts"
import { PROMPT_METADATA_KEY } from "./state.ts"

const TURN_PAGE_SIZE = 200
const TURN_PAGES = 25

export interface Attention {
  readonly permissions: { action: string; resources: string[]; message?: string }[]
  readonly forms: { title: string }[]
}

export async function getSession(sessionID: string): Promise<SessionInfo | undefined> {
  const client = await api()
  return client.session.get({ sessionID }).catch(() => undefined)
}

/** Walks up to the top-level session, which is the tab the user actually works in. */
export async function rootSession(sessionID: string): Promise<SessionInfo | undefined> {
  let session = await getSession(sessionID)
  for (let depth = 0; session?.parentID && depth < 8; depth++) {
    const parent = await getSession(session.parentID)
    if (!parent) break
    session = parent
  }
  return session
}

export async function listSessions(input: { limit: number; search?: string; directory?: string }) {
  const client = await api()
  const response = await client.session.list({
    limit: input.limit,
    order: "desc",
    parentID: null,
    ...(input.search ? { search: input.search } : {}),
    ...(input.directory ? { directory: input.directory } : {}),
  })
  return response.data
}

export async function running(): Promise<Set<string>> {
  const client = await api()
  const active = await client.session.active().catch(() => ({}))
  return new Set(Object.keys(active))
}

export async function attention(client: OpenCodeClient, sessionID: string): Promise<Attention> {
  const [permissions, forms] = await Promise.all([
    client.permission.list({ sessionID }).catch(() => []),
    client.session.form.list({ sessionID }).catch(() => []),
  ])
  return {
    permissions: permissions.map((request) => ({
      action: request.action,
      resources: request.resources,
      message: request.message,
    })),
    forms: forms.map((form) => ({ title: form.title })),
  }
}

/**
 * The session that sent the latest tool prompt in the current turn, if any. A turn is everything after the
 * previous `idle` message; the current turn's own `idle` may or may not be written yet.
 */
export async function promptedBy(sessionID: string): Promise<string | undefined> {
  const client = await api()
  let started = false
  let cursor: string | undefined
  // Long agentic turns hold hundreds of messages, so page back to the turn boundary instead of a fixed window.
  for (let page = 0; page < TURN_PAGES; page++) {
    const response = await client.message
      .list(cursor ? { sessionID, limit: TURN_PAGE_SIZE, cursor } : { sessionID, limit: TURN_PAGE_SIZE, order: "desc" })
      .catch(() => undefined)
    if (!response) return undefined
    for (const message of response.data) {
      if (message.type === "idle") {
        if (started) return undefined
        continue
      }
      started = true
      const metadata = (message as { metadata?: Record<string, unknown> }).metadata
      const from = (metadata?.[PROMPT_METADATA_KEY] as { from?: unknown } | undefined)?.from
      if (message.type === "user" && typeof from === "string") return from
    }
    cursor = response.cursor.next ?? undefined
    if (!cursor || response.data.length < TURN_PAGE_SIZE) return undefined
  }
  return undefined
}

export async function messages(sessionID: string, limit: number): Promise<SessionMessageInfo[]> {
  const client = await api()
  const response = await client.message.list({ sessionID, limit, order: "desc" })
  return response.data.toReversed()
}
