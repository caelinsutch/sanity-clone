"use client"

import { useEffect, useRef, useState } from "react"
import { createComlink, type ComlinkChannel } from "@repo/comlink"
import { useProject } from "@/lib/project-context"
import { subscribeToMutations } from "@/lib/docs"
import { onLocalMutation } from "@/lib/local-mutations"

/**
 * Live preview of the project's demo site, wired to the Studio via Comlink.
 *
 * Each project defines a single `demoUrl`. We:
 *   - Load it through `/api/draft/enable?redirect=<path>` so drafts +
 *     stega are active.
 *   - Forward `visual-editing/focus` events up so click-to-edit selects
 *     the right doc + field in the Studio.
 *   - Mirror iframe navigations back to the Studio so URL resolution
 *     can auto-open the matching document.
 *   - Refresh the iframe whenever a mutation happens — both from the
 *     API's SSE stream (covers external writes) and from the Studio's
 *     own local bus (covers our own writes without waiting for KV
 *     propagation across Cloudflare POPs).
 */
export function LivePreview({
  path,
  onNavigate,
}: {
  path: string
  onNavigate?: (pathname: string) => void
}) {
  const { project } = useProject()
  const demoUrl = project.demoUrl

  const [displayUrl, setDisplayUrl] = useState(`${demoUrl}${path}`)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const comlinkRef = useRef<ComlinkChannel | null>(null)
  const currentPathRef = useRef<string>(path)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    // Project changed — reload iframe to the new demo origin.
    iframe.src = `${demoUrl}/api/draft/enable?redirect=${encodeURIComponent(currentPathRef.current || "/")}`
    setDisplayUrl(`${demoUrl}${currentPathRef.current || "/"}`)
  }, [demoUrl])

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
  }, [demoUrl])

  // Ask the iframe to navigate when the incoming `path` changes.
  useEffect(() => {
    if (!path) return
    if (currentPathRef.current === path) return
    const link = comlinkRef.current
    if (link) {
      link.send("presentation/navigate", { type: "push", url: `${demoUrl}${path}` })
    } else if (iframeRef.current) {
      iframeRef.current.src = `${demoUrl}/api/draft/enable?redirect=${encodeURIComponent(path)}`
    }
    currentPathRef.current = path
  }, [path, demoUrl])

  // Refresh on mutations — SSE (scoped to the project's dataset) + local bus.
  useEffect(() => {
    const fire = () => comlinkRef.current?.send("presentation/refresh", { source: "mutation" })
    const unsubSse = subscribeToMutations(project.dataset, fire)
    const unsubLocal = onLocalMutation(fire)
    return () => {
      unsubSse()
      unsubLocal()
    }
  }, [project.dataset])

  const initialSrc = `${demoUrl}/api/draft/enable?redirect=${encodeURIComponent(path || "/")}`

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
        <span
          style={{
            padding: "2px 6px",
            background: "var(--panel-2)",
            borderRadius: 3,
            color: "inherit",
            fontSize: 10,
          }}
        >
          {project.previewLabel}
        </span>
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
