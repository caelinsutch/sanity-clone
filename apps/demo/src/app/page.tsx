import Link from "next/link"
import { sanityFetch } from "@/lib/client"
import { stegaClean } from "@repo/client/stega"
import { siteSettingsQuery, postListQuery, postCountQuery } from "@/lib/queries"
import type {
  SiteSettingsQueryResult,
  PostListQueryResult,
  PostCountQueryResult,
} from "@/generated"

export default async function Home() {
  const [settings, posts, count] = await Promise.all([
    sanityFetch<SiteSettingsQueryResult>(siteSettingsQuery.query),
    sanityFetch<PostListQueryResult>(postListQuery.query),
    sanityFetch<PostCountQueryResult>(postCountQuery.query),
  ])
  return (
    <>
      <header className="site">
        <h1 className="site-title">{settings?.title ?? "Untitled blog"}</h1>
        <p className="tagline">{settings?.tagline ?? ""}</p>
        <p className="meta">{count} posts</p>
      </header>
      <main>
        <ul className="posts">
          {posts.map((p) => (
            <li key={p._id}>
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
