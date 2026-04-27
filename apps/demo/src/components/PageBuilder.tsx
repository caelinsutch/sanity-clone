import type { Page } from "@/generated"
import { Hero } from "./slices/Hero"
import { FeatureGrid } from "./slices/FeatureGrid"
import { Cta } from "./slices/Cta"
import { RichText } from "./slices/RichText"

type Slice = NonNullable<Page["slices"]>[number]

/**
 * Slice registry: maps a slice's `_type` discriminator to its React component.
 *
 * Consumers own this mapping — different sites can render the same slice
 * types differently. Adding a new slice type in the schema requires:
 *   1. Re-run typegen (the new slice gets a generated interface)
 *   2. Build a component for it
 *   3. Register it here
 */
type SliceComponent<T extends Slice["_type"]> = (props: {
  slice: Extract<Slice, { _type: T }>
}) => React.ReactNode

const sliceComponents: { [K in Slice["_type"]]?: SliceComponent<K> } = {
  heroSlice: Hero,
  featureGridSlice: FeatureGrid,
  ctaSlice: Cta,
  richTextSlice: RichText,
}

export function PageBuilder({ slices }: { slices: Page["slices"] }) {
  if (!slices || slices.length === 0) return null
  return (
    <>
      {slices.map((slice) => renderSlice(slice))}
    </>
  )
}

function renderSlice(slice: Slice): React.ReactNode {
  // Narrow via discriminator so each branch knows the exact slice type.
  switch (slice._type) {
    case "heroSlice":
      return <Hero key={slice._key} slice={slice} />
    case "featureGridSlice":
      return <FeatureGrid key={slice._key} slice={slice} />
    case "ctaSlice":
      return <Cta key={slice._key} slice={slice} />
    case "richTextSlice":
      return <RichText key={slice._key} slice={slice} />
    default: {
      // Exhaustiveness: if you add a new slice type, TS errors here until
      // you handle it. Keeps the registry honest.
      const _exhaustive: never = slice
      return (
        <div
          key={(slice as { _key?: string })._key}
          style={{ padding: 10, background: "#fffbe6", border: "1px solid #ffd54f" }}
        >
          Unknown slice type: <code>{(slice as { _type?: string })._type}</code>
        </div>
      )
    }
  }
}

// Keep sliceComponents reference for extensibility / introspection
export { sliceComponents }
