import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { promptedBy, TURN_PAGE_SIZE, type MessagePage } from "../src/sessions.ts"

const user = (from?: string, key = "sessions") =>
  ({ type: "user", text: "hi", ...(from ? { metadata: { [key]: { from } } } : {}) }) as unknown as SessionMessageInfo
const reply = { type: "assistant", content: [] } as unknown as SessionMessageInfo
const idle = { type: "idle" } as unknown as SessionMessageInfo

// Pages hold messages newest first, like message.list with order "desc".
function pages(...list: SessionMessageInfo[][]): MessagePage {
  return async (_sessionID, cursor) => {
    const index = cursor ? Number(cursor) : 0
    return { data: list[index] ?? [], cursor: { next: index + 1 < list.length ? String(index + 1) : null } }
  }
}

test("finds the sender of the current turn", async () => {
  expect(await promptedBy("ses_a", pages([reply, user("ses_sender"), idle]))).toBe("ses_sender")
})

test("a turn the user started reports to nobody, even after an earlier tool prompt", async () => {
  expect(await promptedBy("ses_a", pages([reply, user(), idle, reply, user("ses_old")]))).toBeUndefined()
})

test("skips the current turn's own trailing idle", async () => {
  expect(await promptedBy("ses_a", pages([idle, reply, user("ses_sender"), idle]))).toBe("ses_sender")
})

test("pages back through long turns", async () => {
  const full = Array.from({ length: TURN_PAGE_SIZE }, () => reply)
  expect(await promptedBy("ses_a", pages(full, [user("ses_sender"), idle]))).toBe("ses_sender")
})

test("reads the metadata key written before the rename", async () => {
  expect(await promptedBy("ses_a", pages([reply, user("ses_legacy", "assistant")]))).toBe("ses_legacy")
})

test("a failing message list reports to nobody", async () => {
  expect(await promptedBy("ses_a", () => Promise.reject(new Error("offline")))).toBeUndefined()
})
