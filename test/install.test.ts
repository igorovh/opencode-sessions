import { expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { foreignImports, serverImports } from "../script/check-dist"

const root = path.join(import.meta.dir, "..")
const pkg = await Bun.file(path.join(root, "package.json")).json()

test("dist/tui.js imports only modules that OpenCode provides", async () => {
  expect(foreignImports(await Bun.file(path.join(root, "dist", "tui.js")).text())).toEqual([])
})

test("the server part imports only host modules and its own dependencies", async () => {
  expect(await serverImports()).toEqual([])
})

// A `github:` install lives under node_modules, where OpenCode skips the Solid transform and resolves
// @opentui/* and solid-js only through its runtime plugin support, never from the plugin's own folder.
test("the TUI part loads and works when installed under node_modules", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "opencode-sessions-install-"))
  try {
    const target = path.join(temp, "node_modules", "opencode-sessions")
    await mkdir(target, { recursive: true })
    for (const entry of pkg.files as string[]) {
      await cp(path.join(root, entry), path.join(target, entry), { recursive: true }).catch(() => {})
    }
    await cp(path.join(root, "package.json"), path.join(target, "package.json"))
    const child = Bun.spawn(["bun", "test", "--preload", "./test/host-preload.ts", "test/tui.test.tsx"], {
      cwd: root,
      env: { ...process.env, SESSIONS_TUI: path.join(target, pkg.exports["./tui"]) },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stderr, exit] = await Promise.all([new Response(child.stderr).text(), child.exited])
    if (exit !== 0) console.error(stderr)
    expect({ exit, failed: stderr.match(/^\(fail\).*$/gm) ?? [] }).toEqual({ exit: 0, failed: [] })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 120_000)
