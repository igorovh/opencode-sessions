import type { OpenCodeClient, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { api } from "./api.ts"
import { PROMPT_METADATA_KEY } from "./state.ts"

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
 * Whether the latest turn of a session includes a prompt the assistant sent. A turn is everything after the
 * previous `idle` message; the current turn's own `idle` may or may not be written yet.
 */
export async function promptedByAssistant(sessionID: string): Promise<boolean> {
  const history = await messages(sessionID, 50).catch(() => [])
  let index = history.length - 1
  while (index >= 0 && history[index]!.type === "idle") index--
  for (; index >= 0 && history[index]!.type !== "idle"; index--) {
    const message = history[index]!
    const metadata = (message as { metadata?: Record<string, unknown> }).metadata
    if (message.type === "user" && metadata?.[PROMPT_METADATA_KEY]) return true
  }
  return false
}

export async function messages(sessionID: string, limit: number): Promise<SessionMessageInfo[]> {
  const client = await api()
  const response = await client.message.list({ sessionID, limit, order: "desc" })
  return response.data.toReversed()
}
