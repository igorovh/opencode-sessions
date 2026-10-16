import type { SessionInfo, SessionMessageInfo } from "@opencode/client"

export function messageText(message: SessionMessageInfo): string | undefined {
  if (message.type === "user") return message.text
  if (message.type === "assistant") {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
      .trim()
    return text || undefined
  }
  if (message.type === "synthetic") return message.description ?? message.text
  return undefined
}

export function toolNames(message: SessionMessageInfo): string[] {
  if (message.type !== "assistant") return []
  return message.content.filter((part) => part.type === "tool").map((part) => part.name)
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export function oneLine(text: string, max: number): string {
  return truncate(text.replace(/\s+/g, " ").trim(), max)
}

export function title(session: Pick<SessionInfo, "id" | "title">): string {
  return session.title?.trim() || session.id
}

export function ago(time: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}
