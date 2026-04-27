import type { RichTextSlice } from "@/generated"
import { PortableText } from "@/components/PortableText"

export function RichText({ slice }: { slice: RichTextSlice }) {
  return (
    <section className="slice slice-rich-text">
      <PortableText blocks={slice.body} />
    </section>
  )
}
