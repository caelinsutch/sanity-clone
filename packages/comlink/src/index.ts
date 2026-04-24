/**
 * A typed postMessage protocol between Sanity Studio (the "presentation"
 * parent window) and the previewed frontend (the iframe).
 *
 * Mirrors `@sanity/comlink` in spirit: named channels, origin-validated
 * bidirectional messaging with a tiny handshake.
 *
 * Channel name convention:
 *   - `presentation` — Studio side
 *   - `visual-editing` — frontend side (child iframe)
 */

export type MessageMap = {
  "presentation/refresh": {
    source: "mutation" | "manual"
    document?: { _id: string; _type: string }
  }
  "presentation/navigate": { type: "push" | "replace" | "pop"; url: string }
  "presentation/focus": { documentId: string; path: string; type: string }
  "visual-editing/ready": { href: string }
  "visual-editing/navigated": { url: string }
  "visual-editing/focus": {
    /** Direction: frontend is telling Studio to focus a field. */
    documentId: string
    type: string
    path: string
  }
  "visual-editing/hover": { documentId: string; path: string } | null
}

export type MessageType = keyof MessageMap
export type Message<T extends MessageType = MessageType> = {
  id: string
  type: T
  channel: string
  data: MessageMap[T]
}

export type Handler = <T extends MessageType>(type: T, data: MessageMap[T]) => void

export interface ComlinkOptions {
  /** Our channel name (who we are). */
  name: "presentation" | "visual-editing"
  /** Target channel name (who we talk to). */
  target: "presentation" | "visual-editing"
  /** Where to post messages (parent or iframe.contentWindow). */
  targetWindow: Window
  /** Allowed origins. "*" means any; for dev only. */
  allowedOrigins: string[] | "*"
  /** Called for every incoming message targeted at us. */
  onMessage: Handler
}

export interface ComlinkChannel {
  send<T extends MessageType>(type: T, data: MessageMap[T]): void
  destroy(): void
  /** Resolves when handshake completes. */
  ready: Promise<void>
}

export function createComlink(opts: ComlinkOptions): ComlinkChannel {
  const { name, target, targetWindow, allowedOrigins, onMessage } = opts

  let readyResolve: () => void
  const ready = new Promise<void>((r) => {
    readyResolve = r
  })
  let isReady = false

  const send = <T extends MessageType>(type: T, data: MessageMap[T]): void => {
    const msg: Message<T> = {
      id: Math.random().toString(36).slice(2),
      type,
      channel: target,
      data,
    }
    targetWindow.postMessage(msg, "*")
  }

  const onWindowMessage = (ev: MessageEvent) => {
    if (allowedOrigins !== "*" && !allowedOrigins.includes(ev.origin)) return
    const data = ev.data
    if (!data || typeof data !== "object") return
    if (data.channel !== name) return
    if (data.type === "__handshake__") {
      // Reply with ack
      targetWindow.postMessage({ type: "__handshake_ack__", channel: target }, "*")
      if (!isReady) {
        isReady = true
        readyResolve!()
      }
      return
    }
    if (data.type === "__handshake_ack__") {
      if (!isReady) {
        isReady = true
        readyResolve!()
      }
      return
    }
    onMessage(data.type, data.data)
  }
  window.addEventListener("message", onWindowMessage)

  // Initiate handshake — keep pinging until the other side acks
  let hsInterval: ReturnType<typeof setInterval> | null = null
  const sendHandshake = () => {
    targetWindow.postMessage({ type: "__handshake__", channel: target }, "*")
  }
  sendHandshake()
  hsInterval = setInterval(() => {
    if (isReady && hsInterval) {
      clearInterval(hsInterval)
      hsInterval = null
    } else {
      sendHandshake()
    }
  }, 250)

  return {
    send,
    destroy() {
      window.removeEventListener("message", onWindowMessage)
      if (hsInterval) clearInterval(hsInterval)
    },
    ready,
  }
}
