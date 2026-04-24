"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { StudioShell } from "@/components/StudioShell"

/**
 * Deep-link handler for Studio intent URLs — the target of stega payloads
 * and `window.open(...)` fallbacks from the visual-editing overlay.
 *
 * URL shape: `/intent/edit/mode=presentation;id=<id>;type=<type>;path=<path>`
 *
 * The segment is ';'-delimited key=value pairs. We parse them, dispatch
 * a `visual-editing/focus` event on `window` so that `StudioShell` (which
 * already listens for that event) selects the right document and field,
 * then render the Shell at the "structure" view so the editor is visible.
 */
export default function IntentEditPage() {
  const params = useParams<{ segment: string }>()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const segment = params?.segment
    if (!segment) return
    const entries = Object.fromEntries(
      segment.split(";").map((kv) => {
        const eq = kv.indexOf("=")
        if (eq === -1) return [kv, ""]
        return [kv.slice(0, eq), decodeURIComponent(kv.slice(eq + 1))]
      }),
    )
    const documentId = entries.id
    const type = entries.type
    const path = entries.path ?? ""
    if (!documentId || !type) {
      setReady(true)
      return
    }
    // Dispatch the same message shape StudioShell listens for
    window.postMessage({ channel: "presentation", type: "visual-editing/focus", data: { documentId, type, path } }, "*")
    setReady(true)
  }, [params])

  if (!ready) {
    return (
      <div style={{ padding: 24, color: "var(--muted)" }}>Loading intent…</div>
    )
  }
  return <StudioShell />
}
