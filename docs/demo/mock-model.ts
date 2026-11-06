// Scripted OpenAI-compatible model for the README demo: no network, no tokens, same run every time.
// Usage: bun docs/demo/mock-model.ts <port> <absolute path of the acme-api demo repo>
const port = Number(process.argv[2] ?? 4599)
const apiDirectory = process.argv[3] ?? "/tmp/demo/acme-api"

type Message = { role: string; content?: unknown; tool_calls?: unknown[] }

function text(message: Message | undefined): string {
  const content = message?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (part as { text?: string }).text ?? "").join("\n")
  return ""
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Reply = { delay: number; text?: string; call?: { name: string; arguments: string } }

function reply(messages: Message[]): Reply {
  const system = messages.filter((message) => message.role === "system").map(text).join("\n")
  const lastUser = messages.findLastIndex((message) => message.role === "user")
  const prompt = text(messages[lastUser])
  const toolResult = messages.slice(lastUser + 1).find((message) => message.role === "tool")

  if (system.includes("Reply with a title")) {
    const all = messages.map(text).join("\n")
    if (all.includes("GET /health")) return { delay: 0, text: "Add /health endpoint" }
    return { delay: 0, text: "Health check rollout" }
  }
  if (prompt.includes("<session-event")) {
    const id = prompt.match(/sessionID="([^"]+)"/)?.[1] ?? ""
    return {
      delay: 900,
      text: "acme-api is done: `GET /health` now returns `{ ok: true }` with a test.\n\n```session\n" + id + "\n```",
    }
  }
  if (prompt.includes("GET /health")) {
    return { delay: 2500, text: "Added `GET /health` in `src/server.ts`, returning `{ ok: true }`, plus a test." }
  }
  if (toolResult) {
    const id = text(toolResult).match(/ses_[A-Za-z0-9]+/)?.[0] ?? ""
    return {
      delay: 600,
      text: "Started it in acme-api. I'll tell you when it finishes.\n\n```session\n" + id + "\n```",
    }
  }
  const code =
    "return await tools.session_new({\n" +
    `  directory: ${JSON.stringify(apiDirectory)},\n` +
    '  title: "Add /health endpoint",\n' +
    '  text: "Add a GET /health endpoint that returns { ok: true }, with a test.",\n' +
    "  focus: false,\n" +
    "})"
  return { delay: 900, call: { name: "execute", arguments: JSON.stringify({ code }) } }
}

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  const body = { id: "demo", object: "chat.completion.chunk", model: "acme-1", choices: [{ index: 0, delta, finish_reason: finish }] }
  return `data: ${JSON.stringify(body)}\n\n`
}

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      return Response.json({ object: "list", data: [{ id: "acme-1", object: "model", owned_by: "demo" }] })
    }
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
      return new Response("not found", { status: 404 })
    }
    const body = (await request.json()) as { messages: Message[] }
    const answer = reply(body.messages)
    await sleep(answer.delay)
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (value: string) => controller.enqueue(encoder.encode(value))
        send(chunk({ role: "assistant" }))
        if (answer.call) {
          send(
            chunk({
              tool_calls: [
                { index: 0, id: `call_${Date.now()}`, type: "function", function: answer.call },
              ],
            }),
          )
          send(chunk({}, "tool_calls"))
        } else {
          // Stream word by word so the reply types out in the recording.
          for (const word of (answer.text ?? "").split(/(?<= )/)) {
            send(chunk({ content: word }))
            await sleep(25)
          }
          send(chunk({}, "stop"))
        }
        send("data: [DONE]\n\n")
        controller.close()
      },
    })
    return new Response(stream, { headers: { "content-type": "text/event-stream" } })
  },
})
console.log(`mock model on http://127.0.0.1:${port}/v1`)
