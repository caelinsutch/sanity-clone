import type { CtaSlice } from "@/generated"

export function Cta({ slice }: { slice: CtaSlice }) {
  return (
    <section className="slice slice-cta">
      <h2>{slice.heading}</h2>
      {slice.buttonLabel && slice.buttonHref ? (
        <a href={slice.buttonHref} className="btn-primary">
          {slice.buttonLabel}
        </a>
      ) : null}
    </section>
  )
}
