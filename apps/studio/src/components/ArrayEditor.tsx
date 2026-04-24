"use client"

import { useState } from "react"
import type { ArrayField, FieldDef, ObjectField } from "@repo/core/schema"
import { FieldRenderer } from "./FieldRenderer"

/**
 * Array-of-objects editor.
 *
 * Renders each item as an expandable row with the item's sub-schema form,
 * plus controls to reorder up/down and delete. An "Add" menu at the bottom
 * shows the allowed item types (each is an inline object with its own fields).
 *
 * Items always carry `_type` (matching the ObjectField.typeName or .name) and
 * `_key` (stable random id for reordering).
 *
 * For this MVP we only support objects-in-arrays (not scalars or images).
 * Portable Text has its own dedicated editor.
 */
export function ArrayEditor({
  field,
  value,
  path,
  onChange,
}: {
  field: ArrayField
  value: unknown
  path: string
  onChange: (path: string, value: unknown) => void
}) {
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
  const objectTypes = field.of.filter((f): f is ObjectField => f.type === "object")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  function update(next: Record<string, unknown>[]) {
    onChange(path, next)
  }

  function add(typeDef: ObjectField) {
    const key = randKey()
    const blank: Record<string, unknown> = { _type: typeDef.typeName ?? typeDef.name, _key: key }
    update([...items, blank])
    setExpanded((e) => ({ ...e, [key]: true }))
  }

  function remove(i: number) {
    const next = items.filter((_, idx) => idx !== i)
    update(next)
  }

  function move(i: number, delta: number) {
    const j = i + delta
    if (j < 0 || j >= items.length) return
    const next = [...items]
    const t = next[i]!
    next[i] = next[j]!
    next[j] = t
    update(next)
  }

  function updateItem(i: number, patch: Record<string, unknown>) {
    const next = [...items]
    next[i] = { ...next[i], ...patch }
    update(next)
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 10,
        background: "var(--panel-2)",
      }}
    >
      {items.length === 0 ? (
        <div style={{ color: "var(--muted)", padding: "4px 0 8px", fontSize: 13 }}>
          No items yet. Add one below.
        </div>
      ) : null}
      {items.map((item, i) => {
        const itemType = resolveItemType(item, objectTypes)
        const key = (item._key as string | undefined) ?? `idx-${i}`
        const isOpen = expanded[key] ?? false
        return (
          <div
            key={key}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 4,
              marginBottom: 6,
              background: "var(--panel)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderBottom: isOpen ? "1px solid var(--border)" : undefined,
              }}
            >
              <button
                onClick={() => setExpanded((e) => ({ ...e, [key]: !isOpen }))}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  padding: 0,
                  width: 16,
                }}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {itemType?.title ?? (item._type as string) ?? "item"}
                </div>
                <div
                  style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}
                >
                  {previewText(item)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <SmallBtn disabled={i === 0} onClick={() => move(i, -1)} label="↑" />
                <SmallBtn disabled={i === items.length - 1} onClick={() => move(i, 1)} label="↓" />
                <SmallBtn onClick={() => remove(i)} label="✕" danger />
              </div>
            </div>
            {isOpen && itemType ? (
              <div style={{ padding: "10px 14px" }}>
                {itemType.fields.map((sub) => (
                  <FieldRenderer
                    key={sub.name}
                    field={sub}
                    value={(item as Record<string, unknown>)[sub.name]}
                    path={`${path}[${i}].${sub.name}`}
                    onChange={(p, v) => {
                      // `p` ends at `.${sub.name}` (or deeper for nested). We only
                      // need the leaf key here — FieldRenderer handles dotted
                      // paths for nested objects via updatePath in the outer editor.
                      // For array items, we collect via a shallow patch on this item.
                      const leaf = p.slice(path.length + `[${i}].`.length)
                      if (!leaf.includes(".") && !leaf.includes("[")) {
                        updateItem(i, { [leaf]: v })
                      } else {
                        // Deep update: materialize dotted path within the item
                        const next = deepSet(items[i] as Record<string, unknown>, leaf, v)
                        const arr = [...items]
                        arr[i] = next
                        update(arr)
                      }
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )
      })}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: items.length ? 10 : 4 }}>
        {objectTypes.map((t) => (
          <button
            key={t.typeName ?? t.name}
            className="btn secondary"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => add(t)}
          >
            + Add {t.title}
          </button>
        ))}
      </div>
    </div>
  )
}

function SmallBtn({
  onClick,
  label,
  disabled,
  danger,
}: {
  onClick: () => void
  label: string
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "var(--panel-2)",
        color: danger ? "var(--danger)" : "var(--fg)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {label}
    </button>
  )
}

function resolveItemType(
  item: Record<string, unknown>,
  types: ObjectField[],
): ObjectField | undefined {
  const name = item._type as string | undefined
  if (!name) return types[0]
  return types.find((t) => (t.typeName ?? t.name) === name)
}

function previewText(item: Record<string, unknown>): string {
  for (const key of ["heading", "title", "name", "text"]) {
    const v = item[key]
    if (typeof v === "string" && v.length > 0) return v
  }
  return (item._key as string | undefined) ?? ""
}

function randKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

function deepSet(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split(".").filter(Boolean)
  const out = { ...obj }
  let cur: Record<string, unknown> = out
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    const existing = cur[p]
    const next =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {}
    cur[p] = next
    cur = next
  }
  cur[parts[parts.length - 1]!] = value
  return out
}
