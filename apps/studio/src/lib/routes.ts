"use client"

/**
 * Resolve a site URL pathname to the owning CMS document, using the bound
 * project's schema `routes` resolvers. This is the Studio's equivalent of
 * Sanity's `mainDocuments` resolver.
 */

import { matchRoute } from "@repo/core/schema"
import type { SanityCloneClient } from "@repo/client"
import type { Project } from "@repo/schema/projects"
import { API_URL } from "./client"

export async function resolveDocumentFromPath(
  project: Project,
  client: SanityCloneClient,
  pathname: string,
): Promise<{ documentId: string; type: string } | null> {
  const match = matchRoute(project.schema, pathname)
  if (!match) return null

  const { route, params } = match
  const { filter, params: queryParams } = route.resolve(params)

  const url = new URL(`/v1/data/query/${encodeURIComponent(project.dataset)}`, API_URL)
  url.searchParams.set("query", filter)
  url.searchParams.set("perspective", "drafts")
  for (const [k, v] of Object.entries(queryParams ?? {})) {
    url.searchParams.set(`$${k}`, JSON.stringify(v))
  }
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${client.config.token ?? ""}` },
  })
  if (!res.ok) return null
  const body = (await res.json()) as { result: { _id?: string; _type?: string } | null }
  const doc = body.result
  if (!doc?._id) return null
  return { documentId: doc._id, type: doc._type ?? route.type }
}
