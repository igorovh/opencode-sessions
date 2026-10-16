import { Rpc } from "@opencode/plugin/rpc"

const openEvent = {
  schema: {
    type: "object",
    properties: { requestID: { type: "string" }, sessionID: { type: "string" }, focus: { type: "boolean" } },
    required: ["requestID", "sessionID", "focus"],
    additionalProperties: false,
  },
} as const

const closeEvent = {
  schema: {
    type: "object",
    properties: { requestID: { type: "string" }, sessionID: { type: "string" } },
    required: ["requestID", "sessionID"],
    additionalProperties: false,
  },
} as const

// Events go from the server plugin to every connected TUI, which owns the tabs; TUIs report back through `ack`.
export const AssistantRpc = Rpc.define({
  id: "assistant",
  methods: {
    ack: {
      input: {
        type: "object",
        properties: {
          requestID: { type: "string" },
          result: { type: "string", description: "What the TUI did, e.g. focused, opened, navigated, closed." },
        },
        required: ["requestID", "result"],
        additionalProperties: false,
      },
      output: { type: "object", additionalProperties: false },
    },
  },
  events: {
    "tab.open": openEvent,
    "tab.close": closeEvent,
  },
})

export interface Ack {
  readonly requestID: string
  readonly result: string
}
