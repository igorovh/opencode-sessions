import { readFile } from "node:fs/promises"
import type { Plugin } from "@opencode/plugin"

export const ASSISTANT_AGENT = "assistant"

function modelHint(options: Plugin.Context["options"]): string {
  const model = typeof options.model === "string" ? options.model.trim() : ""
  const variant = typeof options.variant === "string" ? options.variant.trim() : ""
  if (!model) return "Before creating a session, ask which model to use unless the user already said; otherwise omit model."
  const choice = `\`${model}\`${variant ? ` with variant \`${variant}\`` : ""}`
  return `Before creating a session, ask which model to use unless the user already said; default to ${choice}.`
}

export async function registerAgent(ctx: Plugin.Context) {
  const template = await readFile(new URL("./agent.md", import.meta.url), "utf8")
  const system = template.replace("{{MODEL_HINT}}", modelHint(ctx.options))
  return ctx.agent.transform((editor) =>
    editor.update(ASSISTANT_AGENT, (agent) => {
      agent.description = "Personal assistant that tracks, searches, drives and watches your other OpenCode sessions"
      agent.mode = "primary"
      agent.color = "#7aa2f7"
      agent.system = system
    }),
  )
}
