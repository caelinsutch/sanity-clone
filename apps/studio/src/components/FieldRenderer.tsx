"use client"

import type React from "react"
import type { FieldDef, PortableTextBlock } from "@repo/core/schema"
import type { ValidationIssue } from "@repo/core/validate"
import { ReferencePicker } from "./ReferencePicker"
import { BlockContentEditor } from "./BlockContentEditor"
import { ArrayEditor } from "./ArrayEditor"

/**
 * Universal field renderer: dispatches a `FieldDef` to the matching input
 * widget. Used by both `DocumentEditor` (top-level fields) and `ArrayEditor`
 * (per-item sub-forms).
 *
 * Onchange signature carries a full dotted/bracketed path so parents can
 * deep-merge without having to know the field layout.
 */
export function FieldRenderer({
  field,
  value,
  path,
  onChange,
  issues = [],
}: {
  field: FieldDef
  value: unknown
  path: string
  onChange: (path: string, value: unknown) => void
  issues?: ValidationIssue[]
}) {
  if (field.hidden) return null

  const label = (
    <div className="field-label">
      {field.title}
      {field.validation?.required ? (
        <span style={{ color: "var(--danger)", marginLeft: 4 }}>*</span>
      ) : null}
    </div>
  )
  const description = field.description ? (
    <div className="field-description">{field.description}</div>
  ) : null
  const errors = issues.filter((i) => i.level === "error")
  const errorBlock =
    errors.length > 0 ? (
      <div
        style={{
          color: "var(--danger)",
          fontSize: 12,
          marginTop: 4,
          lineHeight: 1.4,
        }}
      >
        {errors.map((e, i) => (
          <div key={i}>{e.message}</div>
        ))}
      </div>
    ) : null

  const wrap = (children: React.ReactNode) => (
    <div className="field" data-field-path={path}>
      {label}
      {description}
      {children}
      {errorBlock}
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
  if (field.type === "blockContent") {
    const styles = field.styles ?? ["normal", "h2", "h3", "blockquote"]
    return wrap(
      <BlockContentEditor
        value={value as PortableTextBlock[] | undefined | null}
        allowedStyles={styles}
        onChange={(next) => onChange(path, next)}
      />,
    )
  }
  if (field.type === "array") {
    return wrap(
      <ArrayEditor field={field} value={value} path={path} onChange={onChange} />,
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
