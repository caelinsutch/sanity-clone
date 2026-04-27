import type { HeroSlice } from "@/generated"

export function Hero({ slice }: { slice: HeroSlice }) {
  return (
    <section className="slice slice-hero">
      <h1>{slice.heading}</h1>
      {slice.subheading ? <p className="subheading">{slice.subheading}</p> : null}
      {slice.ctaLabel && slice.ctaHref ? (
        <a href={slice.ctaHref} className="btn-primary">
          {slice.ctaLabel}
        </a>
      ) : null}
    </section>
  )
}
