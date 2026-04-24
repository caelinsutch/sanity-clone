/**
 * Portable Text renderer for the demo site.
 *
 * Walks an array of `PortableTextBlock`s and emits semantic HTML. Spans carry
 * `marks` which translate to `<strong>` / `<em>` wrappers.
 *
 * Span text is rendered with its original string value — which means stega
 * invisible characters from the CMS client flow through unchanged, and the
 * visual-editing overlay can click-to-edit individual spans.
 */

import type { PortableTextBlock, PortableTextSpan } from "@repo/core/schema"

export function PortableText({ blocks }: { blocks: PortableTextBlock[] | null | undefined }) {
  if (!blocks || blocks.length === 0) return null
  return (
    <>
      {blocks.map((block) => (
        <Block key={block._key} block={block} />
      ))}
    </>
  )
}

function Block({ block }: { block: PortableTextBlock }) {
  const children = block.children.map((span) => <Span key={span._key} span={span} />)
  switch (block.style) {
    case "h1":
      return <h1>{children}</h1>
    case "h2":
      return <h2>{children}</h2>
    case "h3":
      return <h3>{children}</h3>
    case "h4":
      return <h4>{children}</h4>
    case "blockquote":
      return <blockquote>{children}</blockquote>
    default:
      return <p>{children}</p>
  }
}

function Span({ span }: { span: PortableTextSpan }) {
  let node: React.ReactNode = span.text
  for (const mark of span.marks ?? []) {
    if (mark === "strong") node = <strong>{node}</strong>
    else if (mark === "em") node = <em>{node}</em>
    else if (mark === "code") node = <code>{node}</code>
  }
  return <>{node}</>
}
