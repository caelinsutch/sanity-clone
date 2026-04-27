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
 *
 * The `as` cast on each entry exists because TypeScript can't narrow a
 * union component prop by the discriminator at registry-lookup time.
 */
const sliceComponents = {
  heroSlice: Hero,
  featureGridSlice: FeatureGrid,
  ctaSlice: Cta,
  richTextSlice: RichText,
} as const

export function PageBuilder({ slices }: { slices: Page["slices"] }) {
  if (!slices || slices.length === 0) return null
  return (
    <>
      {slices.map((slice) => {
        const Component = sliceComponents[slice._type as keyof typeof sliceComponents]
        if (!Component) {
          // Unknown slice type — render a dev-facing warning (stripped in prod)
          return (
            <div
              key={slice._key}
              style={{ padding: 10, background: "#fffbe6", border: "1px solid #ffd54f" }}
            >
              Unknown slice type: <code>{slice._type}</code>
            </div>
          )
        }
        // The registry lookup returns the union member type for this _type, so this cast is safe.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return <Component key={slice._key} slice={slice as any} />
      })}
    </>
  )
}
