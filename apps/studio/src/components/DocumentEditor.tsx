"use client"

import { useEffect, useRef, useState } from "react"
import type { FieldDef } from "@repo/core/schema"
import { getTypeDef } from "@repo/core/schema"
import { draftId, isDraftId, publishedId, type SanityDocument } from "@repo/core"
import { schema } from "@repo/schema"
import { studioClient } from "@/lib/client"
import { ReferencePicker } from "./ReferencePicker"

interface Props {
  type: string
  id: string | null
  onDelete: () => void
}

// Returns `{ draftDoc, publishedDoc }` for a given id (either form).
async function loadPair(id: string): Promise<{ draft: SanityDocument | null; published: SanityDocument | null }> {
  const pid = publishedId(id)
  const did = draftId(id)
  const [draft, published] = await Promise.all([studioClient.getDocument(did), studioClient.getDocument(pid)])
  return { draft, published }
}

export function DocumentEditor({ type, id, onDelete }: Props) {
  const typeDef = getTypeDef(schema, type)
  const [doc, setDoc] = useState<SanityDocument | null>(null)
  const [published, setPublished] = useState<SanityDocument | null>(null)
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const focusPathRef = useRef<string | null>(null)

  // Load on id change
  useEffect(() => {
    if (!id) {
      setDoc(null)
      setPublished(null)
      return
    }
    setLoading(true)
    const pid = publishedId(id)
    loadPair(pid).then(({ draft, published }) => {
      setPublished(published)
      if (draft) setDoc(draft)
      else if (published) setDoc({ ...published, _id: draftId(pid) })
      else {
        // New empty doc
        setDoc({
          _id: draftId(pid),
          _type: type,
          _createdAt: "",
          _updatedAt: "",
          _rev: "",
        } as SanityDocument)
      }
      setLoading(false)
    })
  }, [id, type])

  // Listen for focus requests from visual editing
  useEffect(() => {
    const h = (ev: MessageEvent) => {
      const d = ev.data
      if (!d || typeof d !== "object") return
      if (d.channel !== "presentation") return
      if (d.type === "visual-editing/focus") {
        focusPathRef.current = d.data.path
        const el = document.querySelector(`[data-field-path="${d.data.path}"] input, [data-field-path="${d.data.path}"] textarea`)
        if (el instanceof HTMLElement) el.focus()
      }
    }
    window.addEventListener("message", h)
    return () => window.removeEventListener("message", h)
  }, [])

  async function save(next: SanityDocument) {
    setSaveStatus("saving")
    try {
      // Always write to the draft id
      const did = draftId(next._id)
      await studioClient.mutate([{ createOrReplace: { ...next, _id: did } }])
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus("idle"), 800)
    } catch (e) {
      console.error(e)
      setSaveStatus("error")
    }
  }

  // Debounced save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function scheduleSave(next: SanityDocument) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void save(next), 400)
  }

  function updatePath(path: string, value: unknown) {
    if (!doc) return
    const parts = path.split(".")
    const next: Record<string, unknown> = JSON.parse(JSON.stringify(doc))
    let cur = next
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!
      if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {}
      cur = cur[p] as Record<string, unknown>
    }
    cur[parts[parts.length - 1]!] = value
    setDoc(next as SanityDocument)
    scheduleSave(next as SanityDocument)
  }

  async function publish() {
    if (!doc) return
    await save(doc)
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/v1/data/publish/${process.env.NEXT_PUBLIC_DATASET}/${publishedId(doc._id)}`,
      { method: "POST", headers: { authorization: `Bearer dev-admin-token` } },
    )
    if (!res.ok) {
      alert(`Publish failed: ${await res.text()}`)
      return
    }
    // Reload pair
    const { draft, published } = await loadPair(publishedId(doc._id))
    setPublished(published)
    setDoc(draft ?? published)
  }

  async function discardDraft() {
    if (!doc) return
    await studioClient.mutate([{ delete: { id: draftId(doc._id) } }])
    if (published) setDoc({ ...published, _id: draftId(published._id) })
    else {
      setDoc(null)
      onDelete()
    }
  }

  async function deleteAll() {
    if (!doc) return
    if (!confirm("Delete this document (draft and published)?")) return
    const pid = publishedId(doc._id)
    await studioClient.mutate([{ delete: { id: pid } }, { delete: { id: draftId(pid) } }])
    onDelete()
  }

  if (!id) {
    return <Empty text="Select or create a document to begin editing." />
  }
  if (!typeDef) return <Empty text={`Unknown type: ${type}`} />
  if (loading || !doc) return <Empty text="Loading…" />

  const hasDraft = isDraftId(doc._id) && !!doc._createdAt

  return (
    <div style={{ overflowY: "auto", padding: "24px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase" }}>{typeDef.title}</div>
          <div style={{ fontSize: 22, fontWeight: 600, fontFamily: "var(--mono)" }}>{publishedId(doc._id)}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SaveIndicator status={saveStatus} />
          {hasDraft ? (
            <button className="btn secondary" onClick={discardDraft}>
              Discard draft
            </button>
          ) : null}
          <button className="btn danger" onClick={deleteAll}>
            Delete
          </button>
          <button className="btn" onClick={publish}>
            Publish
          </button>
        </div>
      </div>
      <div>
        {typeDef.fields.map((f) => (
          <FieldRenderer key={f.name} field={f} value={(doc as Record<string, unknown>)[f.name]} path={f.name} onChange={updatePath} />
        ))}
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        color: "var(--muted)",
      }}
    >
      {text}
    </div>
  )
}

function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  const label = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Error" : ""
  return (
    <span style={{ color: status === "error" ? "var(--danger)" : "var(--muted)", fontSize: 12, minWidth: 60 }}>
      {label}
    </span>
  )
}

function FieldRenderer({
  field,
  value,
  path,
  onChange,
}: {
  field: FieldDef
  value: unknown
  path: string
  onChange: (path: string, value: unknown) => void
}) {
  if (field.hidden) return null

  const label = (
    <div className="field-label">{field.title}</div>
  )
  const description = field.description ? (
    <div className="field-description">{field.description}</div>
  ) : null

  const wrap = (children: React.ReactNode) => (
    <div className="field" data-field-path={path}>
      {label}
      {description}
      {children}
    </div>
  )

  if (field.type === "string" || field.type === "url") {
    return wrap(
      <input
        value={(value as string) ?? ""}
        onChange={(e) => onChange(path, e.target.value)}
        readOnly={field.readOnly}
      />,
    )
  }
  if (field.type === "text") {
    return wrap(
      <textarea
        value={(value as string) ?? ""}
        rows={field.rows ?? 4}
        onChange={(e) => onChange(path, e.target.value)}
        readOnly={field.readOnly}
      />,
    )
  }
  if (field.type === "number") {
    return wrap(
      <input
        type="number"
        value={(value as number) ?? ""}
        onChange={(e) => onChange(path, e.target.value === "" ? null : Number(e.target.value))}
        readOnly={field.readOnly}
      />,
    )
  }
  if (field.type === "boolean") {
    return wrap(
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          style={{ width: "auto" }}
          checked={!!value}
          onChange={(e) => onChange(path, e.target.checked)}
          disabled={field.readOnly}
        />
        <span>{field.title}</span>
      </label>,
    )
  }
  if (field.type === "slug") {
    const current = ((value as { current?: string })?.current) ?? ""
    return wrap(
      <input
        value={current}
        onChange={(e) => onChange(`${path}.current`, e.target.value)}
        readOnly={field.readOnly}
      />,
    )
  }
  if (field.type === "reference") {
    return wrap(
      <ReferencePicker
        value={value as { _type?: string; _ref?: string } | null | undefined}
        allowedTypes={field.to}
        onChange={(next) => onChange(path, next)}
        readOnly={field.readOnly}
      />,
    )
  }
  if (field.type === "image") {
    const url = ((value as { url?: string })?.url) ?? ""
    return wrap(
      <input
        value={url}
        placeholder="https://…"
        onChange={(e) => onChange(path, { _type: "image", url: e.target.value })}
      />,
    )
  }
  return wrap(<div style={{ color: "var(--muted)" }}>Unsupported field: {field.type}</div>)
}
