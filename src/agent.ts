import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"

export const ASSISTANT_AGENT = "assistant"

function modelHint(options: Plugin.Context["options"]): string {
  const model = typeof options.model === "string" ? options.model.trim() : ""
  const variant = typeof options.variant === "string" ? options.variant.trim() : ""
  if (!model) return "Before creating a session, ask which model to use unless the user already said; otherwise omit model."
  const choice = `\`${model}\`${variant ? ` with variant \`${variant}\`` : ""}`
  return `Before creating a session, ask which model to use unless the user already said; default to ${choice}.`
}

function normalize(directory: string): string {
  const expanded = /^~(?=$|[\\/])/.test(directory) ? homedir() + directory.slice(1) : directory
  const resolved = path.resolve(expanded).replace(/[\\/]+$/, "")
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/** With the `home` option set, the agent exists only in that directory and its subdirectories. */
export function inHome(options: Plugin.Context["options"], directory: string): boolean {
  const home = typeof options.home === "string" ? options.home.trim() : ""
  if (!home) return true
  const current = normalize(directory)
  const root = normalize(home)
  return current === root || current.startsWith(root + path.sep)
}

export async function registerAgent(ctx: Plugin.Context) {
  if (!inHome(ctx.options, ctx.location.directory)) return undefined
  const template = await readFile(new URL("./agent.md", import.meta.url), "utf8")
  const system = template.replace("{{MODEL_HINT}}", modelHint(ctx.options))
  return ctx.agent.transform((editor) =>
    editor.update(ASSISTANT_AGENT, (agent) => {
      agent.name = "Assistant" as never
      agent.description = "Personal assistant that tracks, searches, drives and watches your other OpenCode sessions"
      agent.mode = "primary"
      agent.color = "#7aa2f7"
      agent.system = system
    }),
  )
}
