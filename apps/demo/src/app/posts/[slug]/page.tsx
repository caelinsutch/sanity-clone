import { notFound } from "next/navigation"
import Link from "next/link"
import { sanityFetch, staticParamsFor } from "@/lib/client"
import { postBySlugQuery } from "@/lib/queries"
import type { PostBySlugQueryResult } from "@/generated"
import { PortableText } from "@/components/PortableText"
import type { PortableTextBlock } from "@repo/core/schema"

/**
 * Schema-driven: enumerates all posts at build time by reading the schema's
 * `locations(doc)` and matching against the route pattern. Changing the URL
 * pattern in `packages/schema/src/index.ts` is now the only edit needed.
 */
export const generateStaticParams = staticParamsFor("post")

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await sanityFetch<PostBySlugQueryResult>(
    postBySlugQuery.query,
    { slug },
    { tags: [`post:${slug}`] },
  )
  if (!post) notFound()
  return (
    <main>
      <p className="meta">
        <Link href="/">← All posts</Link>
      </p>
      <h1>{post.title}</h1>
      {post.author ? <p className="meta">by {post.author.name}</p> : null}
      <div className="post-body">
        <PortableText blocks={post.body as unknown as PortableTextBlock[]} />
      </div>
    </main>
  )
}
