import type { Plugin } from "@opencode/plugin"

type Storage = Plugin.Context["storage"]

export interface Watch {
  readonly sessionID: string
  /** Session that receives notifications for this watch: the one that handed out the work or asked to watch. */
  readonly notify: string
  readonly since: number
  readonly note?: string
  /** Set by session_watch: every turn notifies. Otherwise only turns the notify session prompted do. */
  readonly explicit?: boolean
}

/** Metadata key on user messages the tools send, used to tell those turns from the user's own and route replies. */
export const PROMPT_METADATA_KEY = "sessions"
// Written by versions before the rename to opencode-sessions; still read so in-flight turns report back.
const LEGACY_METADATA_KEY = "assistant"

export function promptMetadata(from: string) {
  return { [PROMPT_METADATA_KEY]: { from } }
}

/** The sender recorded on a user message by `promptMetadata`, if any. */
export function promptSender(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = (metadata?.[PROMPT_METADATA_KEY] ?? metadata?.[LEGACY_METADATA_KEY]) as { from?: unknown } | undefined
  return typeof value?.from === "string" ? value.from : undefined
}

const WATCH = "watch/"

export function createState(storage: Storage) {
  return {
    async watch(sessionID: string): Promise<Watch | undefined> {
      const value = await storage.get(WATCH + sessionID)
      return value && typeof value === "object" ? (value as unknown as Watch) : undefined
    },
    addWatch: (watch: Watch) => storage.set(WATCH + watch.sessionID, { ...watch }),
    removeWatch: (sessionID: string) => storage.remove(WATCH + sessionID),
    async watches(): Promise<Watch[]> {
      const result: Watch[] = []
      let after: string | undefined
      do {
        const page = await storage.scan({ prefix: WATCH, after, limit: 200 })
        for (const entry of page.entries) result.push(entry.value as unknown as Watch)
        after = page.next
      } while (after)
      return result
    },
    /** Drops task watches (not explicit ones) started before `before`. */
    async prune(before: number) {
      for (const watch of await this.watches()) {
        if (!watch.explicit && watch.since < before) await storage.remove(WATCH + watch.sessionID)
      }
    },
  }
}

export type State = ReturnType<typeof createState>
