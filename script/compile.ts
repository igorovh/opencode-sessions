import { rm } from "node:fs/promises"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

// OpenCode skips the Solid transform for plugin .tsx under node_modules (a `github:` install), so ship compiled JS.
const root = path.join(import.meta.dir, "..")
const outdir = path.join(root, "dist")

await rm(outdir, { recursive: true, force: true })
const result = await Bun.build({
  entrypoints: [path.join(root, "src", "tui.tsx")],
  outdir,
  root: path.join(root, "src"),
  target: "bun",
  format: "esm",
  external: ["solid-js", "solid-js/*", "@opentui/*", "@opencode/*", "effect", "effect/*"],
  // The transform always generates "universal" output; the module name must match the host's renderer.
  plugins: [createSolidTransformPlugin({ moduleName: "@opentui/solid" })],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
for (const output of result.outputs) {
  // Bun labels modules relative to the cwd as it spells it, so pin the labels for a reproducible dist.
  const code = await Bun.file(output.path).text()
  await Bun.write(output.path, code.replace(/^\/\/ (?:\.\.\/|[^\n]*?\/)*(src\/[^\n/]+)$/gm, "// $1"))
  console.log(path.relative(root, output.path))
}
