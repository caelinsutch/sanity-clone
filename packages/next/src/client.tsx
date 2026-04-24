"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { enableVisualEditing } from "@repo/visual-editing"

/**
 * The client bridge consumers mount in their root layout under draft mode.
 * It:
 *   - Enables overlays + click-to-edit
 *   - Wires Next's router to navigation messages from the Studio iframe
 *   - On `refresh` events from the Studio, calls `router.refresh()` to
 *     re-render server components with the latest draft data
 */
export function VisualEditingBridge() {
  const router = useRouter()
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
      refresh: async () => {
        router.refresh()
      },
    })
    return () => disable()
  }, [router])
  return <div className="sanity-clone-preview-banner">Preview — click any text to edit</div>
}
