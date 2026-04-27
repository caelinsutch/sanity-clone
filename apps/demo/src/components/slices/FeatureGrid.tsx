import type { FeatureGridSlice } from "@/generated"

export function FeatureGrid({ slice }: { slice: FeatureGridSlice }) {
  return (
    <section className="slice slice-feature-grid">
      {slice.heading ? <h2>{slice.heading}</h2> : null}
      <div className="feature-grid">
        {(slice.features ?? []).map((feature) => (
          <div key={feature._key} className="feature">
            <h3>{feature.title}</h3>
            {feature.description ? <p>{feature.description}</p> : null}
          </div>
        ))}
      </div>
    </section>
  )
}
