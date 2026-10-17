import { Plugin } from "@opencode/plugin"
import { registerAgent } from "./agent.ts"
import { AssistantRpc, type Ack } from "./rpc.ts"
import { createState } from "./state.ts"
import { buildTools, registerTools } from "./tools.ts"
import { startWatcher } from "./watcher.ts"

const ACK_TIMEOUT_MS = 2500

export default Plugin.define({
  id: "assistant",
  async setup(ctx) {
    const state = createState(ctx.storage)
    const waiting = new Map<string, { results: string[]; done: () => void }>()
    const rpc = await ctx.rpc.register(AssistantRpc, {
      ack: async (input) => {
        const ack = input as Ack
        console.log(`[assistant] TUI ack ${ack.requestID}: ${ack.result}`)
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
      await emit(requestID)
      await finished
      // Late acks from other TUIs still get logged; keep listening a little longer before forgetting the request.
      setTimeout(() => waiting.delete(requestID), ACK_TIMEOUT_MS)
      return results
    }

    const tabs = {
      open: (sessionID: string, focus: boolean) =>
        request((requestID) => rpc.events.emit("tab.open", { requestID, sessionID, focus })),
      close: (sessionID: string) => request((requestID) => rpc.events.emit("tab.close", { requestID, sessionID })),
    }
    const agent = await registerAgent(ctx)
    const tools = await registerTools(ctx, buildTools(ctx, state, tabs))
    const stop = startWatcher(ctx, state)
    return async () => {
      stop()
      await tools.dispose()
      await agent?.dispose()
      await rpc.dispose()
    }
  },
})
