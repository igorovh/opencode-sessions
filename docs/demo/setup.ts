// Builds a throwaway home with two demo repos and an OpenCode config that uses the mock model and this plugin.
// Usage: bun docs/demo/setup.ts <root>; prints a PowerShell script that switches the shell into the demo.
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(process.argv[2] ?? path.join(process.env.TEMP ?? "/tmp", "opencode-sessions-demo"))
const plugin = path.resolve(import.meta.dir, "..", "..")
const port = 4599
const home = path.join(root, "home")
const xdg = (name: string) => path.join(root, "xdg", name)

rmSync(path.join(root, "xdg"), { recursive: true, force: true })
rmSync(home, { recursive: true, force: true })

const repos = {
  "acme-web": { "README.md": "# acme-web\n\nStorefront for Acme.\n" },
  "acme-api": {
    "README.md": "# acme-api\n\nOrders API for Acme.\n",
    "src/server.ts": 'export const routes = { "/orders": () => [] }\n',
  },
}
for (const [name, files] of Object.entries(repos)) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(home, "demo", name, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  Bun.spawnSync(["git", "init", "-q"], { cwd: path.join(home, "demo", name) })
}

const config = path.join(xdg("config"), "opencode")
mkdirSync(config, { recursive: true })
writeFileSync(
  path.join(config, "opencode.jsonc"),
  JSON.stringify(
    {
      $schema: "https://opencode.ai/config.json",
      model: "mock/acme-1",
      providers: {
        mock: {
          name: "Demo",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "demo" },
          models: {
            "acme-1": {
              name: "acme-1",
              capabilities: { tools: true, input: ["text"], output: ["text"], temperature: true },
              limit: { context: 128000, output: 8000 },
            },
          },
        },
      },
      plugins: [plugin.replaceAll("\\", "/")],
    },
    null,
    2,
  ),
)
writeFileSync(path.join(config, "cli.json"), JSON.stringify({ tabs: { mode: "on", layout: "horizontal" } }, null, 2))
// A separate port, so the demo's background service never collides with a running OpenCode.
writeFileSync(path.join(config, "service.json"), JSON.stringify({ port: 28950 }, null, 2))

const api = path.join(home, "demo", "acme-api")
const web = path.join(home, "demo", "acme-web")
const script = path.join(root, "enter.ps1")
writeFileSync(
  script,
  [
    `$env:HOME = '${home}'`,
    `$env:USERPROFILE = '${home}'`,
    `$env:XDG_CONFIG_HOME = '${xdg("config")}'`,
    `$env:XDG_DATA_HOME = '${xdg("data")}'`,
    `$env:XDG_STATE_HOME = '${xdg("state")}'`,
    `$env:XDG_CACHE_HOME = '${xdg("cache")}'`,
    `Start-Process -WindowStyle Hidden bun -ArgumentList '"${path.join(plugin, "docs", "demo", "mock-model.ts")}"', ${port}, '"${api}"'`,
    `Set-Location '${web}'`,
  ].join("\n"),
)
console.log(script)
