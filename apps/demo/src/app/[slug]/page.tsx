import { notFound } from "next/navigation"
import { sanityFetch, buildClient } from "@/lib/client"
import { pageBySlugQuery } from "@/lib/queries"
import type { PageBySlugQueryResult } from "@/generated"
import { PageBuilder } from "@/components/PageBuilder"

/**
 * Catch-all marketing page route. Renders any `page` document whose
 * `slug.current` matches the URL segment.
 *
 * Note: `/posts/[slug]` takes precedence for post URLs, so this only
 * catches true top-level slugs like `/home`, `/about`, `/pricing`.
 */
export async function generateStaticParams() {
  const client = buildClient()
  const pages = await client.fetch<{ slug?: { current?: string } }[]>(
    '*[_type == "page"]{"slug": slug.current}',
  )
  return pages
    .map((p) => (p.slug as unknown as string | undefined) ?? null)
    .filter((s): s is string => !!s)
    .map((slug) => ({ slug }))
}

export default async function DynamicPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const page = await sanityFetch<PageBySlugQueryResult>(
    pageBySlugQuery.query,
    { slug },
    { tags: [`page:${slug}`] },
  )
  if (!page) notFound()
  return (
    <>
      <PageBuilder slices={page.slices} />
    </>
  )
}
