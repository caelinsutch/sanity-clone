"use client"

/**
 * Resolve a site URL pathname to the owning CMS document, using the schema's
 * `routes` resolvers. This is the Studio's equivalent of Sanity's
 * `mainDocuments` resolver.
 *
 * Example:
 *   pathname "/posts/hello-world"
 *     → matches route { pattern: "/posts/:slug", type: "post" }
 *     → GROQ filter `*[_type == "post" && slug.current == $slug][0]`
 *     → returns `{ documentId, type }` for the matching document.
 */

import { schema } from "@repo/schema"
import { matchRoute } from "@repo/core/schema"
import { DATASET, API_URL, studioClient } from "./client"

export async function resolveDocumentFromPath(
  pathname: string,
): Promise<{ documentId: string; type: string } | null> {
  const match = matchRoute(schema, pathname)
  if (!match) return null

  const { route, params } = match
  const { filter, params: queryParams } = route.resolve(params)

  // Query the API (drafts perspective — so the Studio opens drafts too).
  const url = new URL(`/v1/data/query/${encodeURIComponent(DATASET)}`, API_URL)
  url.searchParams.set("query", filter)
  url.searchParams.set("perspective", "drafts")
  for (const [k, v] of Object.entries(queryParams ?? {})) {
    url.searchParams.set(`$${k}`, JSON.stringify(v))
  }
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${studioClient.config.token ?? ""}` },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { result: { _id?: string; _type?: string } | null }
  const doc = body.result
  if (!doc?._id) return null
  return { documentId: doc._id, type: doc._type ?? route.type }
}
