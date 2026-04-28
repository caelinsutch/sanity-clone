"use client"

import { useEffect, useRef, useState } from "react"
import { createComlink, type ComlinkChannel } from "@repo/comlink"
import { PREVIEW_TARGETS, type PreviewTarget } from "@/lib/client"
import { subscribeToMutations } from "@/lib/docs"
import { onLocalMutation } from "@/lib/local-mutations"

type Mode = "single" | "split"

/**
 * Live preview pane. When the monorepo ships more than one demo frontend
 * (e.g., the Next.js and Astro demos), the Studio can either:
 *
 *   - "single" — one iframe, pick the target from a dropdown
 *   - "split"  — one iframe per target, side-by-side or stacked
 *
 * Both modes share the same behaviour otherwise: each iframe is connected
 * to the Studio via Comlink, forwards `visual-editing/focus` + `/navigated`
 * events up, and listens for `presentation/refresh` on mutations.
 *
 * Choice is persisted in `localStorage`.
 */
export function LivePreview({
  path,
  onNavigate,
}: {
  path: string
  onNavigate?: (pathname: string) => void
}) {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined") return "single"
    const stored = localStorage.getItem("previewMode")
    if (stored === "single" || stored === "split") return stored
    return PREVIEW_TARGETS.length > 1 ? "split" : "single"
  })
  const [singleTargetId, setSingleTargetId] = useState<string>(() => {
    if (typeof window === "undefined") return PREVIEW_TARGETS[0]!.id
    return localStorage.getItem("previewTargetId") ?? PREVIEW_TARGETS[0]!.id
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem("previewMode", mode)
    localStorage.setItem("previewTargetId", singleTargetId)
  }, [mode, singleTargetId])

  const visibleTargets =
    mode === "split"
      ? PREVIEW_TARGETS
      : [PREVIEW_TARGETS.find((t) => t.id === singleTargetId) ?? PREVIEW_TARGETS[0]!]

  // Split layout: vertically stacked when narrow, side-by-side otherwise.
  // We let the browser decide via `minmax`.
  const splitColumns = `repeat(${visibleTargets.length}, minmax(0, 1fr))`

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
        {PREVIEW_TARGETS.length > 1 ? (
          <>
            <ModeToggle mode={mode} setMode={setMode} />
            {mode === "single" ? (
              <select
                value={singleTargetId}
                onChange={(e) => setSingleTargetId(e.target.value)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  padding: "4px 6px",
                  background: "var(--panel-2)",
                  color: "inherit",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                }}
              >
                {PREVIEW_TARGETS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: splitColumns,
          minHeight: 0,
        }}
      >
        {visibleTargets.map((t, i) => (
          <PreviewPane
            key={t.id}
            target={t}
            path={path}
            onNavigate={onNavigate}
            showBorder={i < visibleTargets.length - 1}
            showLabel={mode === "split"}
          />
        ))}
      </div>
    </div>
  )
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
      {(["single", "split"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          style={{
            padding: "4px 8px",
            fontSize: 11,
            fontFamily: "var(--mono)",
            background: mode === m ? "var(--panel-2)" : "transparent",
            color: mode === m ? "inherit" : "var(--muted)",
            border: "none",
            borderLeft: m === "split" ? "1px solid var(--border)" : "none",
            cursor: "pointer",
          }}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function PreviewPane({
  target,
  path,
  onNavigate,
  showBorder,
  showLabel,
}: {
  target: PreviewTarget
  path: string
  onNavigate?: (pathname: string) => void
  showBorder: boolean
  showLabel: boolean
}) {
  const demoUrl = target.url
  const [displayUrl, setDisplayUrl] = useState(`${demoUrl}${path}`)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const comlinkRef = useRef<ComlinkChannel | null>(null)
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
  }, [demoUrl])

  // Navigate the iframe when the path prop changes.
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

  // Refresh on mutations (both SSE and local event bus).
  useEffect(() => {
    const fire = () => comlinkRef.current?.send("presentation/refresh", { source: "mutation" })
    const unsubSse = subscribeToMutations(fire)
    const unsubLocal = onLocalMutation(fire)
    return () => {
      unsubSse()
      unsubLocal()
    }
  }, [])

  const initialSrc = `${demoUrl}/api/draft/enable?redirect=${encodeURIComponent(path || "/")}`

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "32px 1fr",
        minWidth: 0,
        minHeight: 0,
        borderRight: showBorder ? "1px solid var(--border)" : "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          borderBottom: "1px solid var(--border)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--muted)",
          background: "var(--panel)",
        }}
      >
        {showLabel ? (
          <span
            style={{
              padding: "2px 6px",
              background: "var(--panel-2)",
              borderRadius: 3,
              color: "inherit",
              fontSize: 10,
            }}
          >
            {target.label}
          </span>
        ) : null}
        <input
          value={displayUrl}
          onChange={(e) => setDisplayUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && iframeRef.current) iframeRef.current.src = displayUrl
          }}
          style={{ flex: 1, padding: "4px 8px", fontSize: 10 }}
        />
        <button
          className="btn secondary"
          style={{ padding: "2px 8px", fontSize: 10 }}
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