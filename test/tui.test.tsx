/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { Context, KeymapLayer, SlotClaim } from "@opencode/plugin/tui/context"
import { RGBA, type CliRenderer, type Renderable } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import type sourcePlugin from "../src/tui"

// test/install.test.ts points this at a copy installed under node_modules.
const plugin: typeof sourcePlugin = (await import(process.env.SESSIONS_TUI ?? "../src/tui")).default

function fakeTheme(): any {
  const color = RGBA.fromHex("#888888")
  const handler: ProxyHandler<RGBA> = {
    get(target, prop) {
      if (prop in target) {
        const value = Reflect.get(target, prop, target)
        return typeof value === "function" ? value.bind(target) : value
      }
      return new Proxy(color, handler)
    },
  }
  return new Proxy(color, handler)
}

async function setup() {
  const listeners = new Map<string, (event: { data: unknown; location: { directory: string } }) => unknown>()
  const acks: { requestID: string; result: string }[] = []
  const layers: KeymapLayer[] = []
  const claims: SlotClaim[] = []
  const renderers = new Map<string, (token: { text: string }) => Renderable | undefined>()
  const open = new Set(["ses_open"])
  const rpc = {
    ack: async (input: { requestID: string; result: string }) => void acks.push(input),
    events: { on: (name: string, listener: any) => (listeners.set(name, listener), () => listeners.delete(name)) },
  }
  const context = (renderer: CliRenderer) =>
    ({
      options: {},
      renderer,
      theme: fakeTheme(),
      client: { rpc: () => rpc, session: { get: async () => undefined } },
      data: {
        session: { get: () => ({ id: "ses_open", title: "Fix login", location: { directory: "/work/acme-api" } }), sync: async () => {} },
      },
      keymap: { layer: (factory: () => KeymapLayer) => layers.push(factory()) },
      markdown: {
        registerCodeBlockRenderer: (language: string, render: any) => (renderers.set(language, render), () => {}),
      },
      ui: {
        slot: (claim: SlotClaim) => (claims.push(claim), () => {}),
        toast: { show: () => {} },
        format: { path: (value: string) => value },
        router: { current: () => ({ type: "home" }), navigate: () => {} },
        tabs: {
          enabled: () => true,
          list: () => [...open].map((sessionID) => ({ sessionID, active: false })),
          focus: (sessionID: string) => (open.add(sessionID), true),
          open: (sessionID: string) => (open.add(sessionID), true),
          close: (sessionID: string) => open.delete(sessionID),
        },
      },
    }) as unknown as Context

  function Host() {
    void plugin.setup(context(useRenderer()))
    const app = claims.find((claim) => claim.append === "app")!
    return <box>{(app.render as (input: object) => any)({})}</box>
  }
  const rendered = await testRender(() => <Host />, { width: 80, height: 10 })
  await rendered.renderOnce()
  return { ...rendered, listeners, acks, layers, renderers, open }
}

const location = { directory: "/work/acme-web" }

test("the TUI part registers /go and answers tab requests from the server", async () => {
  const ui = await setup()
  expect(ui.layers.flatMap((layer) => layer.commands ?? []).map((command) => command.id)).toContain("sessions.inbox")

  ui.listeners.get("tab.close")!({ data: { requestID: "r1", sessionID: "ses_open" }, location })
  await ui.listeners.get("tab.open")!({ data: { requestID: "r2", sessionID: "ses_new", focus: false }, location })
  await new Promise((resolve) => setTimeout(resolve, 20))

  expect(ui.open.has("ses_open")).toBe(false)
  expect(ui.open.has("ses_new")).toBe(true)
  expect(ui.acks).toEqual([
    { requestID: "r1", result: "closed" },
    { requestID: "r2", result: "opened in background" },
  ])
  ui.renderer.destroy()
})

test("session code blocks render as links", async () => {
  const ui = await setup()
  const box = ui.renderers.get("session")!({ text: "ses_open\n" })
  expect(box?.getChildren().length).toBe(1)
  expect(ui.renderers.get("session")!({ text: "no ids here" })).toBeUndefined()
  ui.renderer.destroy()
})
