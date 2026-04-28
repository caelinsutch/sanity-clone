"use client"

import { useEffect, useRef, useState } from "react"
import { createComlink, type ComlinkChannel } from "@repo/comlink"
import { DEMO_URL } from "@/lib/client"
import { subscribeToMutations } from "@/lib/docs"
import { onLocalMutation } from "@/lib/local-mutations"

/**
 * Live preview iframe of the demo site, wired to the studio via Comlink.
 *
 *  - Loads the demo through its `/api/draft/enable` endpoint so preview mode
 *    (drafts perspective + stega) is active in the iframe.
 *  - Forwards `visual-editing/focus` events from the iframe up to the
 *    Studio shell so clicking text focuses the matching doc + field.
 *  - Emits `visual-editing/navigated` events on every iframe navigation so
 *    the Studio can use the URL to auto-select the matching document.
 *  - When the `path` prop changes (because a different doc was selected in
 *    the editor), navigate the iframe to that path.
 *  - Listens to the API's mutation SSE stream and tells the iframe to
 *    `refresh` so the preview stays in sync with draft saves.
 */
export function LivePreview({
  path,
  onNavigate,
}: {
  /** Path the iframe should be at. The Studio updates this when a doc is selected. */
  path: string
  /** Fires when the iframe navigates on its own (link click, etc). */
  onNavigate?: (pathname: string) => void
}) {
  const [displayUrl, setDisplayUrl] = useState(`${DEMO_URL}${path}`)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const comlinkRef = useRef<ComlinkChannel | null>(null)
  // Track the path the iframe is currently on so we don't re-navigate to it.
  const currentPathRef = useRef<string>(path)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const onLoad = () => {
      comlinkRef.current?.destroy()
      if (!iframe.contentWindow) return
      comlinkRef.current = createComlink({
        name: "presentation",
        target: "visual-editing",
        targetWindow: iframe.contentWindow,
        allowedOrigins: "*",
        onMessage: (type, data) => {
          if (type === "visual-editing/focus") {
            window.postMessage(
              { channel: "presentation", type: "visual-editing/focus", data },
              "*",
            )
          } else if (type === "visual-editing/navigated") {
            const u = new URL((data as { url: string }).url)
            currentPathRef.current = u.pathname
            setDisplayUrl(u.toString())
            onNavigate?.(u.pathname)
          } else if (type === "visual-editing/ready") {
            const u = new URL((data as { href: string }).href)
            currentPathRef.current = u.pathname
            setDisplayUrl(u.toString())
            onNavigate?.(u.pathname)
          }
        },
      })
    }
    iframe.addEventListener("load", onLoad)
    return () => {
      iframe.removeEventListener("load", onLoad)
      comlinkRef.current?.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ask the iframe to navigate when the incoming `path` changes.
  useEffect(() => {
    if (!path) return
    if (currentPathRef.current === path) return
    const link = comlinkRef.current
    if (link) {
      link.send("presentation/navigate", { type: "push", url: `${DEMO_URL}${path}` })
    } else if (iframeRef.current) {
      // Not yet connected (first load) — just set src.
      iframeRef.current.src = `${DEMO_URL}/api/draft/enable?redirect=${encodeURIComponent(path)}`
    }
    currentPathRef.current = path
  }, [path])

  // Refresh the iframe when a mutation occurs — from either the API's SSE
  // stream (covers external/background changes) or the Studio's own local
  // event bus (reliable + instant for edits made in this tab; doesn't rely
  // on Cloudflare KV propagation between POPs).
  useEffect(() => {
    const fire = () => comlinkRef.current?.send("presentation/refresh", { source: "mutation" })
    const unsubSse = subscribeToMutations(fire)
    const unsubLocal = onLocalMutation(fire)
    return () => {
      unsubSse()
      unsubLocal()
    }
  }, [])

  const initialSrc = `${DEMO_URL}/api/draft/enable?redirect=${encodeURIComponent(path || "/")}`

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "40px 1fr",
        background: "var(--panel)",
        minWidth: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        <span>Preview</span>
        <input
          value={displayUrl}
          onChange={(e) => setDisplayUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && iframeRef.current) iframeRef.current.src = displayUrl
          }}
          style={{ flex: 1, padding: "6px 10px", fontSize: 11 }}
        />
        <button
          className="btn secondary"
          style={{ padding: "4px 10px", fontSize: 11 }}
          onClick={() => {
            if (iframeRef.current) iframeRef.current.src = displayUrl
          }}
        >
          Go
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={initialSrc}
        style={{ border: "none", width: "100%", height: "100%", background: "white" }}
      />
    </div>
  )
}
