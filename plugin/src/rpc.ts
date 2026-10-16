import { Rpc } from "@opencode/plugin/rpc"

const sessionEvent = {
  schema: {
    type: "object",
    properties: { sessionID: { type: "string" } },
    required: ["sessionID"],
    additionalProperties: false,
  },
} as const

// Events from the server plugin to every connected TUI, which owns the tabs.
export const AssistantRpc = Rpc.define({
  id: "assistant",
  methods: {},
  events: {
    "tab.open": sessionEvent,
    "tab.close": sessionEvent,
  },
})
