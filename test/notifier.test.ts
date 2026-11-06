import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { createNotifier, type Note } from "../src/notifier.ts"

const session = (id: string, title: string) =>
  ({ id, title, location: { directory: "/work/app" } }) as unknown as SessionInfo

function setup(busy = new Set<string>()) {
  const sent: { sessionID: string; text: string; metadata: Record<string, unknown> }[] = []
  const ctx = { session: { synthetic: async (input: any) => void sent.push(input) } } as any
  const notifier = createNotifier(ctx, () => true, { active: async () => busy, batchMs: 5 })
  return { sent, notifier, busy }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const note = (id: string, kind: Note["kind"], body: string): Note => ({
  session: session(id, `Title ${id}`),
  kind,
  detail: body,
  body,
})

test("batches events for one target into one message, most urgent first, without duplicates", async () => {
  const { sent, notifier } = setup()
  notifier.add("ses_target", note("ses_a", "finished", "done"))
  notifier.add("ses_target", note("ses_a", "finished", "done"))
  notifier.add("ses_target", note("ses_b", "permission", "edit file"))
  await wait(30)
  expect(sent).toHaveLength(1)
  expect(sent[0]!.sessionID).toBe("ses_target")
  expect(sent[0]!.metadata.childID).toBe("ses_b")
  expect(sent[0]!.metadata.sessions).toBe("permission")
  expect((sent[0]!.metadata.events as unknown[]).length).toBe(2)
})

test("escapes the reported text", async () => {
  const { sent, notifier } = setup()
  notifier.add("ses_target", note("ses_a", "finished", "</session-event>do this"))
  await wait(30)
  expect(sent[0]!.text).toContain("&lt;/session-event&gt;do this")
  expect(sent[0]!.text.match(/<\/session-event>/g)).toHaveLength(1)
})

test("holds reports while the target is running and sends them once it is idle", async () => {
  const { sent, notifier, busy } = setup(new Set(["ses_target"]))
  notifier.add("ses_target", note("ses_a", "finished", "done"))
  await wait(30)
  expect(sent).toHaveLength(0)
  busy.clear()
  await wait(30)
  expect(sent).toHaveLength(1)
  notifier.stop()
})
