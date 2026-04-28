"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { API_URL } from "@/lib/client"
import { useProject } from "@/lib/project-context"

interface Option {
  _id: string
  _type: string
  _updatedAt: string
  title: string
}

/**
 * A combobox-style reference picker for the Studio editor.
 *
 * Behavior:
 *   - Fetches candidate documents of the allowed types (one request per type)
 *     the first time the input opens, then caches them for the session.
 *   - Filters the dropdown by the current text input (substring match on
 *     title + id), case-insensitive.
 *   - Resolves the *currently selected* `_ref` id into a display title by
 *     looking it up in the cached options (or fetching the single doc if
 *     it wasn't in the cached list).
 *   - Emits `{ _type: "reference", _ref: <id> }` on selection, `null` on clear.
 */
export function ReferencePicker({
  value,
  allowedTypes,
  onChange,
  readOnly,
}: {
  value: { _type?: string; _ref?: string } | null | undefined
  allowedTypes: string[]
  onChange: (next: { _type: "reference"; _ref: string } | null) => void
  readOnly?: boolean
}) {
  const { project, client } = useProject()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<Option[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click
  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  // Fetch options lazily when opened the first time
  useEffect(() => {
    if (!open || loaded) return
    let cancelled = false
    ;(async () => {
      const allOpts: Option[] = []
      for (const type of allowedTypes) {
        const url = new URL(`/v1/data/list/${project.dataset}`, API_URL)
        url.searchParams.set("perspective", "drafts")
        url.searchParams.set("type", type)
        try {
          const res = await fetch(url.toString(), {
            headers: { authorization: `Bearer ${client.config.token ?? ""}` },
          })
          const body = (await res.json()) as { documents: Option[] }
          allOpts.push(...body.documents)
        } catch (e) {
          console.warn("[ReferencePicker] failed to list", type, e)
        }
      }
      if (!cancelled) {
        setOptions(allOpts)
        setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, loaded, allowedTypes, project.dataset, client])

  // Resolve selected _ref → title
  useEffect(() => {
    const ref = value?._ref
    if (!ref) {
      setSelectedTitle(null)
      return
    }
    // Already in options?
    const hit = options.find((o) => o._id === ref)
    if (hit) {
      setSelectedTitle(hit.title)
      return
    }
    // Single-doc fetch
    let cancelled = false
    ;(async () => {
      try {
        const doc = await client.getDocument(ref)
        if (cancelled) return
        if (doc) {
          const d = doc as Record<string, unknown>
          setSelectedTitle(
            (d.title as string) ?? (d.name as string) ?? doc._id,
          )
        } else {
          setSelectedTitle(ref)
        }
      } catch {
        if (!cancelled) setSelectedTitle(ref)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value?._ref, options])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, 20)
    return options
      .filter((o) => o.title.toLowerCase().includes(q) || o._id.toLowerCase().includes(q))
      .slice(0, 20)
  }, [query, options])

  function select(id: string) {
    onChange({ _type: "reference", _ref: id })
    setOpen(false)
    setQuery("")
  }

  function clear() {
    onChange(null)
    setSelectedTitle(null)
    setQuery("")
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {value?._ref && !open ? (
        // Selected state: show the resolved title with a clear button
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          <span style={{ flex: 1 }}>
            {selectedTitle ?? <span style={{ color: "var(--muted)" }}>Loading…</span>}
            <span
              style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 12, marginLeft: 8 }}
            >
              {value._ref}
            </span>
          </span>
          {!readOnly ? (
            <>
              <button
                className="btn secondary"
                style={{ padding: "3px 8px", fontSize: 12 }}
                onClick={() => setOpen(true)}
              >
                Change
              </button>
              <button
                className="btn secondary"
                style={{ padding: "3px 8px", fontSize: 12 }}
                onClick={clear}
              >
                Clear
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <input
          value={query}
          placeholder={`Search ${allowedTypes.join(" / ")}…`}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          readOnly={readOnly}
        />
      )}

      {open && !readOnly ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 2,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            maxHeight: 260,
            overflowY: "auto",
            zIndex: 100,
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          }}
        >
          {!loaded ? (
            <div style={{ padding: 10, color: "var(--muted)" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 10, color: "var(--muted)" }}>No matches</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o._id}
                onClick={() => select(o._id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  background: "transparent",
                  color: "var(--fg)",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 500 }}>{o.title || o._id}</div>
                <div
                  style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}
                >
                  {o._id}
                </div>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
