"use client"

import { useRef } from "react"
import type { BlockStyle, PortableTextBlock, PortableTextSpan } from "@repo/core/schema"

/**
 * A minimal Portable Text editor.
 *
 * Simplifications vs. Sanity's real editor:
 *  - Each block is a single contenteditable line that fits one paragraph/heading.
 *    Press Enter to split; Backspace at the start merges with the previous block.
 *  - Marks (bold/italic) are toggled via keyboard shortcuts Cmd/Ctrl+B and Cmd/Ctrl+I.
 *    A mark applied to a range creates a new span boundary.
 *  - Style is chosen from a dropdown per block (normal / h2 / h3 / blockquote).
 *  - No drag-reorder, no link annotations (markDefs left as `[]`).
 *
 * This is enough to demonstrate Portable Text end-to-end: edits round-trip
 * through the API as structured JSON, are renderable by the demo, and stega
 * works on span.text.
 */
export function BlockContentEditor({
  value,
  onChange,
  allowedStyles,
}: {
  value: PortableTextBlock[] | undefined | null
  onChange: (next: PortableTextBlock[]) => void
  allowedStyles: BlockStyle[]
}) {
  const blocks = value && value.length > 0 ? value : [emptyBlock()]

  function update(i: number, next: PortableTextBlock) {
    const out = [...blocks]
    out[i] = next
    onChange(out)
  }

  function insertAfter(i: number) {
    const out = [...blocks]
    out.splice(i + 1, 0, emptyBlock())
    onChange(out)
  }

  function removeAt(i: number) {
    if (blocks.length === 1) return // keep at least one
    const out = blocks.filter((_, idx) => idx !== i)
    onChange(out)
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 10,
        background: "var(--panel-2)",
      }}
    >
      {blocks.map((block, i) => (
        <BlockRow
          key={block._key}
          block={block}
          allowedStyles={allowedStyles}
          onChange={(next) => update(i, next)}
          onEnter={() => insertAfter(i)}
          onBackspaceAtStart={() => {
            if (blocks.length === 1) return
            // Merge into previous
            const prev = blocks[i - 1]
            if (!prev) return
            const merged: PortableTextBlock = {
              ...prev,
              children: [...prev.children, ...block.children].filter((c) => c.text !== "") ,
            }
            const out = [...blocks]
            out.splice(i - 1, 2, merged)
            onChange(out)
          }}
          onRemove={() => removeAt(i)}
        />
      ))}
    </div>
  )
}

function BlockRow({
  block,
  allowedStyles,
  onChange,
  onEnter,
  onBackspaceAtStart,
  onRemove,
}: {
  block: PortableTextBlock
  allowedStyles: BlockStyle[]
  onChange: (next: PortableTextBlock) => void
  onEnter: () => void
  onBackspaceAtStart: () => void
  onRemove: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  // Flatten children to a displayed string.
  const flatText = block.children.map((c) => c.text).join("")

  function handleInput(ev: React.FormEvent<HTMLDivElement>) {
    // For simplicity, squash the whole block to a single span on every keystroke.
    // This loses formatting granularity within a line but keeps the data model
    // honest. A real editor would walk the DOM and preserve span boundaries.
    const newText = ev.currentTarget.textContent ?? ""
    if (newText === flatText) return
    onChange({
      ...block,
      children: [
        {
          _type: "span",
          _key: block.children[0]?._key ?? randKey(),
          text: newText,
          marks: block.children[0]?.marks ?? [],
        },
      ],
    })
  }

  function handleKeyDown(ev: React.KeyboardEvent<HTMLDivElement>) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault()
      onEnter()
      return
    }
    if (ev.key === "Backspace") {
      const sel = window.getSelection()
      if (sel && sel.isCollapsed && sel.anchorOffset === 0 && (ref.current?.textContent ?? "") === "") {
        ev.preventDefault()
        onRemove()
        return
      }
      if (sel && sel.isCollapsed && sel.anchorOffset === 0 && (ref.current?.textContent ?? "").length > 0) {
        // At position 0 with content — merge with previous block
        ev.preventDefault()
        onBackspaceAtStart()
      }
    }
    // Cmd/Ctrl+B → toggle bold on all spans
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "b") {
      ev.preventDefault()
      toggleMark("strong")
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "i") {
      ev.preventDefault()
      toggleMark("em")
    }
  }

  function toggleMark(mark: string) {
    // Toggles the mark on every span in the block. A proper editor would
    // split by selection range; for this minimal editor we apply to the
    // whole block — good enough for demonstration.
    const allHave = block.children.every((c) => (c.marks ?? []).includes(mark))
    const next: PortableTextBlock = {
      ...block,
      children: block.children.map((c) => ({
        ...c,
        marks: allHave
          ? (c.marks ?? []).filter((m) => m !== mark)
          : [...(c.marks ?? []), mark],
      })),
    }
    onChange(next)
  }

  const style = block.style || "normal"
  const styleProps: React.CSSProperties =
    style === "h2"
      ? { fontSize: 22, fontWeight: 600, lineHeight: 1.2 }
      : style === "h3"
        ? { fontSize: 18, fontWeight: 600, lineHeight: 1.3 }
        : style === "h4"
          ? { fontSize: 15, fontWeight: 600 }
          : style === "blockquote"
            ? {
                borderLeft: "3px solid var(--muted)",
                paddingLeft: 10,
                color: "var(--muted)",
                fontStyle: "italic",
              }
            : {}

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <select
        value={style}
        onChange={(e) => onChange({ ...block, style: e.target.value as BlockStyle })}
        style={{ width: 120, fontSize: 12, padding: "4px 6px" }}
      >
        {allowedStyles.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        style={{
          flex: 1,
          minHeight: 24,
          padding: "6px 8px",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          outline: "none",
          ...styleProps,
        }}
      >
        {renderChildren(block.children)}
      </div>
    </div>
  )
}

function renderChildren(children: PortableTextSpan[]): React.ReactNode {
  return children.map((c, i) => {
    let node: React.ReactNode = c.text
    for (const mark of c.marks ?? []) {
      if (mark === "strong") node = <strong key={`strong-${i}`}>{node}</strong>
      else if (mark === "em") node = <em key={`em-${i}`}>{node}</em>
    }
    return <span key={c._key ?? i}>{node}</span>
  })
}

function emptyBlock(): PortableTextBlock {
  return {
    _type: "block",
    _key: randKey(),
    style: "normal",
    children: [{ _type: "span", _key: randKey(), text: "", marks: [] }],
    markDefs: [],
  }
}

function randKey(): string {
  return Math.random().toString(36).slice(2, 10)
}
