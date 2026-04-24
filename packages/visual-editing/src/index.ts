/**
 * Visual editing overlay runtime for the previewed frontend.
 *
 * Responsibilities:
 *   1. Scan the DOM for stega-encoded text and decode source metadata.
 *   2. Also honor manual `data-sanity-edit-target` and `data-sanity` attrs.
 *   3. Paint transparent click-to-edit overlays over elements.
 *   4. When clicked, post a message through Comlink to the Studio asking it
 *      to focus the corresponding document + field.
 *   5. Bridge navigation history with the Studio parent.
 *   6. Accept "refresh" requests from the Studio (e.g. after a mutation).
 */

import { createComlink, type ComlinkChannel } from "@repo/comlink"
import { decodeStega } from "@repo/client/stega"

export interface EditTarget {
  documentId: string
  type: string
  path: string
  studioUrl: string
}

export interface VisualEditingOptions {
  history?: {
    subscribe: (navigate: (u: { type: "push" | "replace" | "pop"; url: string }) => void) => () => void
    update: (u: { type: "push" | "replace" | "pop"; url: string }) => void
  }
  refresh?: (payload: { source: "mutation" | "manual" }) => Promise<void> | void | false
  allowedOrigins?: string[] | "*"
}

const STYLE_ID = "__sanity_clone_overlay_style__"

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement("style")
  s.id = STYLE_ID
  s.textContent = `
    [data-sanity-overlay] {
      position: absolute;
      pointer-events: auto;
      box-sizing: border-box;
      border: 1px solid rgba(45, 125, 246, 0.35);
      background: rgba(45, 125, 246, 0.06);
      border-radius: 2px;
      transition: border-color 120ms, background 120ms;
      z-index: 2147483646;
      cursor: pointer;
    }
    [data-sanity-overlay]:hover {
      border-color: rgba(45, 125, 246, 1);
      background: rgba(45, 125, 246, 0.14);
    }
    [data-sanity-overlay-root] {
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      pointer-events: none;
      z-index: 2147483646;
    }
  `
  document.head.appendChild(s)
}

export function enableVisualEditing(options: VisualEditingOptions = {}): () => void {
  if (typeof window === "undefined") return () => {}
  injectStyle()

  // If a previous invocation's root is still in the DOM (React strict-mode
  // double-invoke), reuse it so we don't flash.
  let root = document.querySelector<HTMLDivElement>("[data-sanity-overlay-root]")
  if (!root) {
    root = document.createElement("div")
    root.setAttribute("data-sanity-overlay-root", "")
    document.body.appendChild(root)
  }

  let comlink: ComlinkChannel | null = null
  const isIframed = window.parent && window.parent !== window
  if (isIframed) {
    comlink = createComlink({
      name: "visual-editing",
      target: "presentation",
      targetWindow: window.parent,
      allowedOrigins: options.allowedOrigins ?? "*",
      onMessage: (type, data) => {
        if (type === "presentation/refresh") {
          void options.refresh?.(data as { source: "mutation" | "manual" })
        } else if (type === "presentation/navigate") {
          options.history?.update(data as { type: "push" | "replace" | "pop"; url: string })
        }
      },
    })
    void comlink.ready.then(() => {
      comlink!.send("visual-editing/ready", { href: location.href })
    })
  }

  const unsubscribeHistory = options.history?.subscribe((u) => {
    comlink?.send("visual-editing/navigated", { url: u.url })
  })

  // --- Overlay painting ----------------------------------------------------

  interface Target {
    el: HTMLElement
    edit: EditTarget
    overlay: HTMLDivElement
  }
  // Map element -> its overlay so we can diff scans without nuking overlays.
  const targets = new Map<HTMLElement, Target>()

  function parseStegaFromElement(el: HTMLElement): EditTarget | null {
    // Skip our own overlay-related nodes
    if (el.hasAttribute("data-sanity-overlay") || el.hasAttribute("data-sanity-overlay-root"))
      return null

    // 1. Manual data-sanity JSON attribute
    const ds = el.dataset.sanity
    if (ds) {
      try {
        const parsed = JSON.parse(ds) as EditTarget
        if (parsed.documentId && parsed.type && parsed.path) return parsed
      } catch {
        /* ignore */
      }
    }

    // 2. Stega: look at DIRECT child text nodes only
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue
      const text = node.nodeValue ?? ""
      const decoded = decodeStega(text)
      if (!decoded) continue
      try {
        const payload = JSON.parse(decoded.payload) as { origin?: string; href?: string }
        if (!payload.href) continue
        const u = new URL(payload.href)
        const m = u.pathname.match(/\/intent\/edit\/([^/]+)$/)
        if (!m) continue
        const params = Object.fromEntries(
          m[1]!.split(";").map((kv) => {
            const eq = kv.indexOf("=")
            if (eq === -1) return [kv, ""]
            return [kv.slice(0, eq), decodeURIComponent(kv.slice(eq + 1))]
          }),
        )
        if (params.id && params.type && params.path !== undefined) {
          return {
            documentId: params.id,
            type: params.type,
            path: params.path,
            studioUrl: `${u.origin}${u.pathname.replace(/\/intent\/edit\/.*$/, "")}`,
          }
        }
      } catch {
        /* not a valid stega payload */
      }
    }
    return null
  }

  function buildOverlay(target: Pick<Target, "el" | "edit">): HTMLDivElement {
    const overlay = document.createElement("div")
    overlay.setAttribute("data-sanity-overlay", "")
    overlay.title = `${target.edit.type} / ${target.edit.path}`
    overlay.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      comlink?.send("visual-editing/focus", {
        documentId: target.edit.documentId,
        type: target.edit.type,
        path: target.edit.path,
      })
      if (!isIframed) {
        const url = `${target.edit.studioUrl}/intent/edit/mode=presentation;id=${target.edit.documentId};type=${target.edit.type};path=${encodeURIComponent(
          target.edit.path,
        )}`
        window.open(url, "_blank")
      }
    })
    return overlay
  }

  function positionOverlay(overlay: HTMLDivElement, el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    overlay.style.top = `${rect.top + window.scrollY}px`
    overlay.style.left = `${rect.left + window.scrollX}px`
    overlay.style.width = `${rect.width}px`
    overlay.style.height = `${rect.height}px`
    return true
  }

  function scan() {
    // Walk the DOM; find all editable elements.
    const seen = new Set<HTMLElement>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    let node: Node | null = walker.currentNode
    while (node) {
      if (node instanceof HTMLElement) {
        // Skip the overlay root entirely (don't traverse into it)
        if (node === root || node.hasAttribute("data-sanity-overlay-root")) {
          // Skip the whole subtree
          node = walker.nextSibling() ?? walker.nextNode()
          continue
        }
        const edit = parseStegaFromElement(node)
        if (edit) {
          seen.add(node)
          let target = targets.get(node)
          if (!target) {
            const overlay = buildOverlay({ el: node, edit })
            root!.appendChild(overlay)
            target = { el: node, edit, overlay }
            targets.set(node, target)
          } else {
            // Update edit metadata in case the stega changed
            target.edit = edit
          }
        }
      }
      node = walker.nextNode()
    }
    // Remove stale overlays
    for (const [el, target] of Array.from(targets.entries())) {
      if (!seen.has(el)) {
        target.overlay.remove()
        targets.delete(el)
      }
    }
    paint()
  }

  function paint() {
    for (const target of targets.values()) {
      if (!positionOverlay(target.overlay, target.el)) {
        // Hide if zero-sized but leave in DOM so it can reappear
        target.overlay.style.display = "none"
      } else {
        target.overlay.style.display = ""
      }
    }
  }

  let rafId = 0
  let scanPending = false
  const schedulePaint = () => {
    if (scanPending) return
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => paint())
  }
  const scheduleScan = () => {
    scanPending = true
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      scanPending = false
      scan()
    })
  }

  // MutationObserver watching only the app content, not our overlay root.
  const mo = new MutationObserver((mutations) => {
    // Ignore mutations originating inside our overlay root
    for (const m of mutations) {
      let n: Node | null = m.target
      while (n) {
        if (n instanceof HTMLElement && n.hasAttribute("data-sanity-overlay-root")) {
          return
        }
        n = n.parentNode
      }
    }
    scheduleScan()
  })
  mo.observe(document.body, { subtree: true, childList: true, characterData: true })
  window.addEventListener("scroll", schedulePaint, { passive: true })
  window.addEventListener("resize", schedulePaint)

  // Initial scan
  scan()

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    mo.disconnect()
    window.removeEventListener("scroll", schedulePaint)
    window.removeEventListener("resize", schedulePaint)
    unsubscribeHistory?.()
    comlink?.destroy()
    for (const t of targets.values()) t.overlay.remove()
    targets.clear()
    if (root && root.parentNode) root.parentNode.removeChild(root)
  }
}

/**
 * Build a value for a `data-sanity` attribute, for non-string fields
 * (images, numbers, booleans) where stega can't reach.
 */
export function createDataAttribute(params: {
  id: string
  type: string
  path: string
  baseUrl: string
}): { toString: () => string } {
  const json = JSON.stringify({
    documentId: params.id,
    type: params.type,
    path: params.path,
    studioUrl: params.baseUrl,
  })
  return { toString: () => json }
}
