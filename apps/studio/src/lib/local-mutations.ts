/**
 * A tiny in-app pub/sub that the Studio uses to tell its LivePreview iframe
 * to refresh immediately after a successful local mutation. This is the
 * reliable fallback to the API's SSE mutation channel (KV-backed, which
 * is eventually consistent across Cloudflare POPs — so SSE alone can miss
 * events for up to a minute in production).
 *
 * The Studio always knows when it just wrote a draft, so we don't actually
 * need the server round-trip for the common case; SSE remains useful for
 * picking up mutations that happen in other tabs or from seeding.
 */

type Listener = () => void

const listeners = new Set<Listener>()

export function onLocalMutation(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function emitLocalMutation(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch (e) {
      console.warn("[local-mutations] listener threw", e)
    }
  }
}
