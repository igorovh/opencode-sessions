import { Plugin } from "@opencode/plugin"
import { SessionsRpc, type Ack } from "./rpc.ts"
import { createState } from "./state.ts"
import { buildTools, registerTools } from "./tools.ts"
import { startWatcher } from "./watcher.ts"

const ACK_TIMEOUT_MS = 2500
// Watches from session_send/session_new only label sessions in session_list, so old ones are dropped.
const TASK_WATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000

export default Plugin.define({
  id: "sessions",
  async setup(ctx) {
    const state = createState(ctx.storage)
    const waiting = new Map<string, { results: string[]; done: () => void }>()
    const rpc = await ctx.rpc.register(SessionsRpc, {
      ack: async (input) => {
        const ack = input as Ack
        const entry = waiting.get(ack.requestID)
        if (entry) {
          entry.results.push(ack.result)
          entry.done()
        }
        return {}
      },
    })

    // Emits a tab request and waits briefly for TUIs to confirm, so the tool can report what happened.
    async function request(emit: (requestID: string) => Promise<void>): Promise<string[]> {
      const requestID = crypto.randomUUID()
      const results: string[] = []
      const finished = new Promise<void>((resolve) => {
        waiting.set(requestID, { results, done: resolve })
        setTimeout(resolve, ACK_TIMEOUT_MS)
      })
      try {
        await emit(requestID)
        await finished
        return results
      } finally {
        // Other TUIs may still answer; keep listening a little longer before forgetting the request.
        setTimeout(() => waiting.delete(requestID), ACK_TIMEOUT_MS)
      }
    }

    const tabs = {
      open: (sessionID: string, focus: boolean) =>
        request((requestID) => rpc.events.emit("tab.open", { requestID, sessionID, focus })),
      close: (sessionID: string) => request((requestID) => rpc.events.emit("tab.close", { requestID, sessionID })),
    }
    await state.prune(Date.now() - TASK_WATCH_TTL_MS).catch((error) => console.error("[sessions] prune failed", error))
    const tools = await registerTools(ctx, buildTools(ctx, state, tabs))
    const stop = startWatcher(ctx, state)
    return async () => {
      stop()
      await tools.dispose()
      await rpc.dispose()
    }
  },
})
