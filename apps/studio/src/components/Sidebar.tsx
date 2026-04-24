"use client"

import { schema } from "@repo/schema"

export function Sidebar({
  selectedType,
  onSelectType,
}: {
  selectedType: string
  onSelectType: (t: string) => void
}) {
  return (
    <div
      style={{
        borderRight: "1px solid var(--border)",
        background: "var(--panel)",
        padding: "8px 0",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: 0.04,
          color: "var(--muted)",
        }}
      >
        Content
      </div>
      {schema.types.map((t) => (
        <button
          key={t.name}
          onClick={() => onSelectType(t.name)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "8px 14px",
            background: selectedType === t.name ? "var(--panel-2)" : "transparent",
            color: selectedType === t.name ? "var(--fg)" : "var(--muted)",
            border: "none",
            borderLeft:
              "3px solid " + (selectedType === t.name ? "var(--accent)" : "transparent"),
          }}
        >
          {t.title}
        </button>
      ))}
    </div>
  )
}
