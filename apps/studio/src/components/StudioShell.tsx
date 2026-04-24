"use client"

import { useEffect, useState } from "react"
import { schema } from "@repo/schema"
import { getTypeDef } from "@repo/core/schema"
import { publishedId } from "@repo/core"
import { Sidebar } from "./Sidebar"
import { DocumentEditor } from "./DocumentEditor"
import { LivePreview } from "./LivePreview"
import { useDocuments } from "@/lib/docs"
import { studioClient } from "@/lib/client"
import { resolveDocumentFromPath } from "@/lib/routes"

/**
 * The whole studio is a single side-by-side layout:
 *
 *   ┌───────┬────────────┬────────────────┬──────────────────┐
 *   │ types │ doc list   │ editor form    │  live preview    │
 *   └───────┴────────────┴────────────────┴──────────────────┘
 *
 * Two-way binding between the editor + iframe:
 *   - Selecting a doc in the form → iframe navigates to `locations()[0].href`.
 *   - Iframe navigates to a URL → the Studio matches the schema's `routes`
 *     and auto-opens the owning document in the editor.
 */
export function StudioShell() {
  const [showPreview, setShowPreview] = useState(true)
  const [selectedType, setSelectedType] = useState<string>(schema.types[0]!.name)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string>("/")

  // When a document is selected, resolve its `locations()` to set the iframe URL.
  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    ;(async () => {
      const typeDef = getTypeDef(schema, selectedType)
      if (!typeDef?.locations) return
      // We need the doc itself to compute locations — fetch the draft/published pair.
      const pid = publishedId(selectedId)
      const doc =
        (await studioClient.getDocument(`drafts.${pid}`)) ??
        (await studioClient.getDocument(pid))
      if (cancelled || !doc) return
      const locs = typeDef.locations(doc as unknown as Record<string, unknown>)
      if (locs.length === 0) return
      setPreviewPath(locs[0]!.href)
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId, selectedType])

  // Listen for focus events posted by (1) the live preview iframe via
  // Comlink (stega click-to-edit), or (2) the `/intent/edit/...` route.
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      const d = ev.data
      if (!d || typeof d !== "object") return
      if (d.channel !== "presentation") return
      if (d.type === "visual-editing/focus") {
        setSelectedType(d.data.type)
        setSelectedId(d.data.documentId)
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  // When the iframe navigates to a new path, try to resolve the owning doc.
  async function onIframeNavigate(pathname: string) {
    const resolved = await resolveDocumentFromPath(pathname)
    if (resolved) {
      setSelectedType(resolved.type)
      setSelectedId(resolved.documentId)
    }
  }

  const columns = showPreview
    ? "240px 300px minmax(380px, 1fr) minmax(400px, 1.3fr)"
    : "240px 300px 1fr"

  return (
    <div style={{ display: "grid", gridTemplateRows: "48px 1fr", height: "100vh" }}>
      <Topbar showPreview={showPreview} setShowPreview={setShowPreview} />
      <div style={{ display: "grid", gridTemplateColumns: columns, height: "100%", minHeight: 0 }}>
        <Sidebar
          selectedType={selectedType}
          onSelectType={(t) => {
            setSelectedType(t)
            setSelectedId(null)
          }}
        />
        <DocumentList
          type={selectedType}
          selectedId={selectedId}
          onSelect={(id) => setSelectedId(id)}
        />
        <div
          style={{
            overflowY: "auto",
            borderRight: showPreview ? "1px solid var(--border)" : "none",
            minWidth: 0,
          }}
        >
          <DocumentEditor
            type={selectedType}
            id={selectedId}
            onDelete={() => setSelectedId(null)}
          />
        </div>
        {showPreview ? <LivePreview path={previewPath} onNavigate={onIframeNavigate} /> : null}
      </div>
    </div>
  )
}

function Topbar({
  showPreview,
  setShowPreview,
}: {
  showPreview: boolean
  setShowPreview: (b: boolean) => void
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        background: "var(--panel)",
        borderBottom: "1px solid var(--border)",
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 600, letterSpacing: -0.2 }}>sanity-clone studio</div>
      <div style={{ flex: 1 }} />
      <button
        onClick={() => setShowPreview(!showPreview)}
        style={{
          background: showPreview ? "var(--accent)" : "var(--panel-2)",
          color: showPreview ? "white" : "var(--muted)",
          border: "1px solid " + (showPreview ? "var(--accent)" : "var(--border)"),
          borderRadius: 6,
          padding: "5px 14px",
        }}
      >
        {showPreview ? "Preview: on" : "Preview: off"}
      </button>
    </div>
  )
}

function DocumentList({
  type,
  selectedId,
  onSelect,
}: {
  type: string
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { docs } = useDocuments(type)
  return (
    <div
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--panel)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.04,
          color: "var(--muted)",
        }}
      >
        <span>{type}</span>
        <button
          className="btn secondary"
          style={{ padding: "3px 8px", fontSize: 12 }}
          onClick={() => onSelect(`drafts.${type}-${Math.random().toString(36).slice(2, 7)}`)}
        >
          + New
        </button>
      </div>
      <div>
        {docs.map((d) => (
          <div
            key={d._id}
            onClick={() => onSelect(d._id)}
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: selectedId === d._id ? "var(--panel-2)" : "transparent",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 500 }}>{d.title || d._id}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
              {d._id}
            </div>
          </div>
        ))}
        {docs.length === 0 ? (
          <div style={{ padding: 14, color: "var(--muted)" }}>No documents of type {type} yet.</div>
        ) : null}
      </div>
    </div>
  )
}
