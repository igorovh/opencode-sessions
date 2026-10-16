import { Plugin } from "@opencode/plugin"
import { AssistantRpc } from "./rpc.ts"
import { createState } from "./state.ts"
import { buildTools, registerTools } from "./tools.ts"
import { startWatcher } from "./watcher.ts"

export default Plugin.define({
  id: "assistant",
  async setup(ctx) {
    const state = createState(ctx.storage)
    const rpc = await ctx.rpc.register(AssistantRpc, {})
    const tabs = {
      open: (sessionID: string) => rpc.events.emit("tab.open", { sessionID }),
      close: (sessionID: string) => rpc.events.emit("tab.close", { sessionID }),
    }
    const tools = await registerTools(ctx, buildTools(ctx, state, tabs))
    const stop = startWatcher(ctx, state)
    return async () => {
      stop()
      await tools.dispose()
      await rpc.dispose()
    }
  },
})
