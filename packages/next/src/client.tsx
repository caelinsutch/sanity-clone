"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { enableVisualEditing } from "@repo/visual-editing"

/**
 * The client bridge consumers mount in their root layout under draft mode.
 * It:
 *   - Enables overlays + click-to-edit
 *   - Wires Next's router to navigation messages from the Studio iframe
 *   - On `refresh` events from the Studio, re-renders server components
 *     with the latest draft data.
 *
 * Refresh strategy: Next's `router.refresh()` does not reliably re-render
 * statically prerendered routes inside a draft-mode iframe on Next 16 —
 * the client keeps serving the cached RSC segment. To guarantee the
 * preview reflects the latest draft, we debounce mutation events and
 * trigger a hard reload. It's a single frame of flicker but always
 * correct. Non-mutation refreshes still use `router.refresh()`.
 */
export function VisualEditingBridge() {
  const router = useRouter()
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const disable = enableVisualEditing({
      history: {
        subscribe: (navigate) => {
          const handler = () => navigate({ type: "pop", url: location.href })
          addEventListener("popstate", handler)
          return () => removeEventListener("popstate", handler)
        },
        update: (u) => {
          const path = new URL(u.url, location.href).pathname
          if (u.type === "push") router.push(path)
          else if (u.type === "replace") router.replace(path)
        },
      },
      refresh: async (payload) => {
        if (payload?.source === "mutation") {
          // Debounce so a burst of edits (Studio saves on every keystroke
          // at 400ms debounce) coalesces to a single reload.
          if (reloadTimer.current) clearTimeout(reloadTimer.current)
          reloadTimer.current = setTimeout(() => {
            reloadTimer.current = null
            window.location.reload()
          }, 350)
        } else {
          router.refresh()
        }
      },
    })
    return () => {
      disable()
      if (reloadTimer.current) clearTimeout(reloadTimer.current)
    }
  }, [router])
  return <div className="sanity-clone-preview-banner">Preview — click any text to edit</div>
}
