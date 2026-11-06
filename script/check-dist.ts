import { readdir, readFile } from "node:fs/promises"
import { isBuiltin } from "node:module"
import path from "node:path"

const root = path.join(import.meta.dir, "..")

// Only these modules come from the host; anything else would load a second copy from the plugin's node_modules.
export const HOST_MODULES = new Set([
  "@opencode/plugin",
  "@opencode/plugin/tui",
  "@opencode/plugin/rpc",
  "effect",
  "@opentui/core",
  "@opentui/solid",
  "@opentui/solid/components",
  "@opentui/solid/jsx-runtime",
  "solid-js",
  "solid-js/store",
])

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g
// Type-only imports vanish at runtime, so they may name anything.
const TYPE_IMPORT = /\bimport\s+type\b[^;]*?\bfrom\s*["'][^"']+["']/g

function imports(code: string) {
  return [...code.replace(TYPE_IMPORT, "").matchAll(IMPORT)].map((match) => match[1]!)
}

export function foreignImports(code: string) {
  return imports(code).filter((specifier) => !isBuiltin(specifier) && !specifier.startsWith(".") && !HOST_MODULES.has(specifier))
}

/** Runtime imports of the server part that neither the host nor the package's dependencies provide. */
export async function serverImports() {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"))
  const dependencies = Object.keys(pkg.dependencies ?? {})
  const provided = (specifier: string) =>
    dependencies.some((name) => specifier === name || specifier.startsWith(`${name}/`))
  const src = path.join(root, "src")
  const files = (await readdir(src)).filter((file) => file.endsWith(".ts"))
  const result: string[] = []
  for (const file of files) {
    for (const specifier of foreignImports(await readFile(path.join(src, file), "utf8"))) {
      if (!provided(specifier)) result.push(`src/${file}: ${specifier}`)
    }
  }
  return result
}

if (import.meta.main) {
  const dist = path.join(root, "dist")
  const files = (await readdir(dist)).filter((file) => file.endsWith(".js"))
  if (!files.includes("tui.js")) throw new Error("dist/tui.js is missing; run `bun run compile`")
  let failed = false
  for (const file of files) {
    const code = await readFile(path.join(dist, file), "utf8")
    if (/@opentui\/solid\/jsx-(?:dev-)?runtime/.test(code)) {
      console.error(`dist/${file}: JSX was not compiled by the Solid transform`)
      failed = true
    }
    for (const specifier of foreignImports(code)) {
      console.error(`dist/${file}: imports "${specifier}", which OpenCode does not provide`)
      failed = true
    }
  }
  for (const problem of await serverImports()) {
    console.error(`${problem}, which neither OpenCode nor the dependencies provide`)
    failed = true
  }
  if (failed) process.exit(1)
  console.log(`dist OK: ${files.join(", ")}`)
}
