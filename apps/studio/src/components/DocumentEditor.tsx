"use client"

import { useEffect, useRef, useState } from "react"
import { getTypeDef } from "@repo/core/schema"
import { validateDocument, type ValidationIssue } from "@repo/core/validate"
import { draftId, isDraftId, publishedId, type SanityDocument } from "@repo/core"
import type { SanityCloneClient } from "@repo/client"
import { useProject } from "@/lib/project-context"
import { API_URL } from "@/lib/client"
import { emitLocalMutation } from "@/lib/local-mutations"
import { FieldRenderer } from "./FieldRenderer"

interface Props {
  type: string
  id: string | null
  onDelete: () => void
}

async function loadPair(
  client: SanityCloneClient,
  id: string,
): Promise<{ draft: SanityDocument | null; published: SanityDocument | null }> {
  const pid = publishedId(id)
  const did = draftId(id)
  const [draft, published] = await Promise.all([
    client.getDocument(did),
    client.getDocument(pid),
  ])
  return { draft, published }
}

export function DocumentEditor({ type, id, onDelete }: Props) {
  const { project, client } = useProject()
  const typeDef = getTypeDef(project.schema, type)
  const [doc, setDoc] = useState<SanityDocument | null>(null)
  const [published, setPublished] = useState<SanityDocument | null>(null)
  const [loading, setLoading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const focusPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!id) {
      setDoc(null)
      setPublished(null)
      return
    }
    setLoading(true)
    const pid = publishedId(id)
    loadPair(client, pid).then(({ draft, published }) => {
      setPublished(published)
      if (draft) setDoc(draft)
      else if (published) setDoc({ ...published, _id: draftId(pid) })
      else {
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
  }, [id, type, client])

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
      const did = draftId(next._id)
      await client.mutate([{ createOrReplace: { ...next, _id: did } }])
      emitLocalMutation()
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus("idle"), 800)
    } catch (e) {
      console.error(e)
      setSaveStatus("error")
    }
  }

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
      `${API_URL}/v1/data/publish/${project.dataset}/${publishedId(doc._id)}`,
      { method: "POST", headers: { authorization: `Bearer ${client.config.token ?? ""}` } },
    )
    if (!res.ok) {
      alert(`Publish failed: ${await res.text()}`)
      return
    }
    emitLocalMutation()
    const { draft, published } = await loadPair(client, publishedId(doc._id))
    setPublished(published)
    setDoc(draft ?? published)
  }

  async function discardDraft() {
    if (!doc) return
    await client.mutate([{ delete: { id: draftId(doc._id) } }])
    emitLocalMutation()
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
    await client.mutate([{ delete: { id: pid } }, { delete: { id: draftId(pid) } }])
    emitLocalMutation()
    onDelete()
  }

  if (!id) {
    return <Empty text="Select or create a document to begin editing." />
  }
  if (!typeDef) return <Empty text={`Unknown type: ${type}`} />
  if (loading || !doc) return <Empty text="Loading…" />

  const hasDraft = isDraftId(doc._id) && !!doc._createdAt

  const issues = typeDef
    ? validateDocument(typeDef, doc as unknown as Record<string, unknown>)
    : []
  const errorIssues = issues.filter((i) => i.level === "error")
  const issuesByPath: Record<string, ValidationIssue[]> = {}
  for (const i of issues) {
    ;(issuesByPath[i.path] ??= []).push(i)
  }
  const hasErrors = errorIssues.length > 0

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
          <button
            className="btn"
            onClick={publish}
            disabled={hasErrors}
            title={hasErrors ? `${errorIssues.length} validation error(s)` : "Publish this draft"}
            style={
              hasErrors
                ? { opacity: 0.5, cursor: "not-allowed" }
                : undefined
            }
          >
            Publish
          </button>
        </div>
      </div>
      {hasErrors ? (
        <div
          style={{
            background: "rgba(240, 82, 82, 0.1)",
            border: "1px solid var(--danger)",
            color: "var(--danger)",
            padding: "10px 14px",
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 13,
          }}
        >
          <strong>{errorIssues.length} issue(s) block publishing:</strong>
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            {errorIssues.map((i, idx) => (
              <li key={idx}>
                <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{i.path}</code>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        {typeDef.fields.map((f) => (
          <FieldRenderer
            key={f.name}
            field={f}
            value={(doc as Record<string, unknown>)[f.name]}
            path={f.name}
            onChange={updatePath}
            issues={issuesByPath[f.name] ?? []}
          />
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
