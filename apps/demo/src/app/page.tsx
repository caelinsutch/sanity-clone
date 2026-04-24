import Link from "next/link"
import { sanityFetch } from "@/lib/client"
import { stegaClean } from "@repo/client/stega"
import { siteSettingsQuery, postListQuery } from "@/lib/queries"
import type { SiteSettingsQueryResult, PostListQueryResult } from "@/generated"

/**
 * SSG home page. Cached with the "sanity" tag so mutations in the CMS
 * can revalidate this page via the `/api/revalidate` webhook.
 *
 * In draft mode `sanityFetch` switches to `cache: "no-store"` + drafts.
 */
export default async function Home() {
  const [settings, posts] = await Promise.all([
    sanityFetch<SiteSettingsQueryResult>(siteSettingsQuery.query),
    sanityFetch<PostListQueryResult>(postListQuery.query),
  ])
  return (
    <>
      <header className="site">
        <h1 className="site-title">{settings?.title ?? "Untitled blog"}</h1>
        <p className="tagline">{settings?.tagline ?? ""}</p>
      </header>
      <main>
        <ul className="posts">
          {posts.map((p) => (
            <li key={p._id}>
              {/* Stega-encoded slug must be cleaned before URL use */}
              <Link href={`/posts/${stegaClean(p.slug)}`}>
                <h2>{p.title}</h2>
                <p>{p.excerpt}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}
