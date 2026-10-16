import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { Service } from "@opencode/client/service"

let pending: Promise<OpenCodeClient> | undefined

// The plugin context lacks session listing and message history, so those go through the local HTTP API.
export function api(): Promise<OpenCodeClient> {
  pending ??= (async () => {
    const endpoint = await Service.discover()
    if (!endpoint) throw new Error("Could not discover the local OpenCode service.")
    return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
  })()
  pending.catch(() => {
    pending = undefined
  })
  return pending
}
