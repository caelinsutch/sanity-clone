/**
 * Visual-editing bridge for Astro sites.
 *
 * Astro is MPA-first — there's no client router to drive. When the
 * Studio sends a `presentation/navigate`, we do a full-page navigation;
 * on mutation refreshes we hard-reload (debounced). The overlay +
 * stega click-to-edit all come from `@repo/visual-editing` directly.
 *
 * Mount once from any client-side script, e.g.:
 *
 *   <script>
 *     import { mountVisualEditing } from "@repo/astro/bridge"
 *     mountVisualEditing()
 *   </script>
 */

import { enableVisualEditing } from "@repo/visual-editing"

export function mountVisualEditing(): () => void {
  let reloadTimer: ReturnType<typeof setTimeout> | null = null
  const disable = enableVisualEditing({
    history: {
      subscribe: (navigate) => {
        const handler = () => navigate({ type: "pop", url: location.href })
        addEventListener("popstate", handler)
        return () => removeEventListener("popstate", handler)
      },
      update: (u) => {
        const target = new URL(u.url, location.href).pathname
        if (u.type === "push") location.assign(target)
        else if (u.type === "replace") location.replace(target)
      },
    },
    refresh: async (payload) => {
      if (payload?.source === "mutation") {
        if (reloadTimer) clearTimeout(reloadTimer)
        reloadTimer = setTimeout(() => {
          reloadTimer = null
          location.reload()
        }, 350)
      } else {
        location.reload()
      }
    },
  })
  return () => {
    disable()
    if (reloadTimer) clearTimeout(reloadTimer)
  }
}
