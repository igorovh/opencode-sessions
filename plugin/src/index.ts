import { Plugin } from "@opencode/plugin"
import { createState } from "./state.ts"
import { buildTools, registerTools } from "./tools.ts"
import { startWatcher } from "./watcher.ts"

export default Plugin.define({
  id: "assistant",
  async setup(ctx) {
    const state = createState(ctx.storage)
    const tools = await registerTools(ctx, buildTools(ctx, state))
    const stop = startWatcher(ctx, state)
    return async () => {
      stop()
      await tools.dispose()
    }
  },
})
