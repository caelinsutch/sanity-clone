"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { StudioShell } from "@/components/StudioShell"

/**
 * Deep-link handler for Studio intent URLs. The new URL shape is:
 *   `/<projectId>/intent/edit/mode=presentation;id=<id>;type=<type>;path=<path>`
 *
 * Parent layout `[projectId]/layout.tsx` already supplies the ProjectProvider.
 * We just parse the segment and postMessage a `visual-editing/focus` event
 * so `StudioShell` selects the right document and field.
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
    window.postMessage(
      { channel: "presentation", type: "visual-editing/focus", data: { documentId, type, path } },
      "*",
    )
    setReady(true)
  }, [params])

  if (!ready) {
    return <div style={{ padding: 24, color: "var(--muted)" }}>Loading intent…</div>
  }
  return <StudioShell />
}
