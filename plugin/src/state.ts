import type { Plugin } from "@opencode/plugin"

type Storage = Plugin.Context["storage"]

export interface Watch {
  readonly sessionID: string
  /** Assistant session that receives notifications for this watch. */
  readonly notify: string
  readonly since: number
  readonly note?: string
}

const HOME = "assistant-home"
const WATCH = "watch/"

export function createState(storage: Storage) {
  return {
    async home(): Promise<string | undefined> {
      const value = await storage.get(HOME)
      return typeof value === "string" ? value : undefined
    },
    setHome: (sessionID: string) => storage.set(HOME, sessionID),
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
  }
}

export type State = ReturnType<typeof createState>
