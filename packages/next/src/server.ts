/**
 * Server-side half of `@repo/next`:
 *   - `getClient()` — draft-mode-aware client
 *   - `sanityFetch()` — cached fetch with `next.tags`
 *   - `DRAFT_ROUTES` — route handlers for /api/draft/enable, /disable, /api/revalidate
 *   - `staticParamsFor()` — build-time enumerator for `generateStaticParams`
 *
 * `defineCms()` composes everything together for a one-call setup.
 */

import { cookies, draftMode } from "next/headers"
import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { createClient, type FetchOptions } from "@repo/client"
import type { Schema } from "@repo/core/schema"
import { VisualEditingBridge } from "./client"

export interface CmsConfig {
  apiUrl: string
  dataset: string
  studioUrl: string
  /** Server-only read token used when in draft mode. */
  token?: string
  /** Shared secret that the CMS API must include when calling the revalidation webhook. */
  revalidateSecret?: string
  /** Cache tag applied to every fetch. Defaults to "sanity". */
  cacheTag?: string
  /**
   * The content schema. When provided, `staticParamsFor()` and
   * `resolveRoute()` can enumerate documents + map URL params to docs
   * without the consumer having to repeat that wiring.
   */
  schema?: Schema
}

export interface ConfiguredCms {
  /** Factory: draft-mode-aware client with stega auto-toggled. */
  getClient: () => Promise<ReturnType<typeof createClient>>
  /** Cached fetch with `next.tags` + per-request draft-mode perspective. */
  sanityFetch: <T = unknown>(
    query: string,
    params?: Record<string, unknown>,
    options?: { tags?: string[]; revalidate?: number | false },
  ) => Promise<T>
  /** Client used from `generateStaticParams()` (no cookies involved). */
  buildClient: () => Promise<ReturnType<typeof createClient>>
  /** Route handlers. Export `GET` from a route file and assign one of these. */
  DRAFT_ROUTES: {
    enable: (req: Request) => Promise<Response>
    disable: (req: Request) => Promise<Response>
    revalidate: (req: Request) => Promise<Response>
  }
  /** Client component — mount inside the root layout when draft mode is on. */
  VisualEditingBridge: typeof VisualEditingBridge
  /**
   * Return a `generateStaticParams` function for a given document type.
   * Pulls the schema's `routes` definition to know which GROQ field maps
   * to the URL param name.
   *
   * Usage in a Next.js page:
   *
   *   export const generateStaticParams = cms.staticParamsFor("post")
   *
   * Requires `schema` to be passed to `defineCms`.
   */
  staticParamsFor: (typeName: string) => () => Promise<Array<Record<string, string>>>
}

export function defineCms(config: CmsConfig): ConfiguredCms {
  const cacheTag = config.cacheTag ?? "sanity"

  /**
   * On Cloudflare Workers, same-subdomain worker→worker fetches over the
   * public `*.workers.dev` URL are rejected with error 1042. If OpenNext
   * has provided a service binding named `API` via `getCloudflareContext`,
   * we route all server-side API calls through it. Otherwise we use the
   * global fetch (localhost dev, Vercel, Node, etc.).
   */
  async function resolveFetcher(): Promise<typeof fetch | undefined> {
    try {
      const mod = (await import("@opennextjs/cloudflare").catch(() => null)) as
        | { getCloudflareContext?: () => { env?: Record<string, unknown> } }
        | null
      const ctx = mod?.getCloudflareContext?.()
      const binding = ctx?.env?.API as
        | { fetch: (req: Request | string, init?: RequestInit) => Promise<Response> }
        | undefined
      if (binding && typeof binding.fetch === "function") {
        const bound = binding.fetch.bind(binding)
        return ((input, init) => {
          // Service bindings ignore the host; any absolute URL works.
          return bound(input as Request | string, init as RequestInit)
        }) as typeof fetch
      }
    } catch {
      /* no-op */
    }
    return undefined
  }

  async function getClient() {
    const { isEnabled } = await draftMode()
    const fetcher = await resolveFetcher()
    return createClient({
      apiUrl: config.apiUrl,
      dataset: config.dataset,
      perspective: isEnabled ? "drafts" : "published",
      token: isEnabled ? config.token : undefined,
      stega: { enabled: isEnabled, studioUrl: config.studioUrl },
      fetcher,
    })
  }

  async function buildClient() {
    const fetcher = await resolveFetcher()
    return createClient({
      apiUrl: config.apiUrl,
      dataset: config.dataset,
      perspective: "published",
      stega: { enabled: false, studioUrl: config.studioUrl },
      fetcher,
    })
  }

  async function sanityFetch<T>(
    query: string,
    params: Record<string, unknown> = {},
    options: { tags?: string[]; revalidate?: number | false } = {},
  ): Promise<T> {
    const client = await getClient()
    const { isEnabled } = await draftMode()
    const fetchOpts: FetchOptions = isEnabled
      ? { cache: "no-store" }
      : {
          cache: "force-cache",
          next: { tags: [cacheTag, ...(options.tags ?? [])], revalidate: options.revalidate },
        }
    return client.fetch<T>(query, params, fetchOpts)
  }

  const DRAFT_ROUTES = {
    async enable(req: Request) {
      const url = new URL(req.url)
      const redirect = url.searchParams.get("redirect") ?? "/"
      // Use Next's built-in draftMode() so all the cookie semantics are handled.
      const dm = await draftMode()
      dm.enable()
      return NextResponse.redirect(new URL(redirect, url.origin))
    },
    async disable(req: Request) {
      const url = new URL(req.url)
      const redirect = url.searchParams.get("redirect") ?? "/"
      const dm = await draftMode()
      dm.disable()
      return NextResponse.redirect(new URL(redirect, url.origin))
    },
    async revalidate(req: Request) {
      const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      if (config.revalidateSecret && got !== config.revalidateSecret) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 })
      }
      let body: { tags?: string[] } = {}
      try {
        body = (await req.json()) as { tags?: string[] }
      } catch {
        /* empty */
      }
      revalidateTag(cacheTag, "max")
      for (const t of body.tags ?? []) revalidateTag(t, "max")
      return NextResponse.json({ revalidated: true, tags: [cacheTag, ...(body.tags ?? [])] })
    },
  }

  /**
   * Build a `generateStaticParams()` function for Next.js, driven entirely
   * by the schema's `routes` + each doc's `locations()`.
   *
   * Algorithm: find the route whose `type` matches, fetch every doc of that
   * type, call `locations(doc)` to get canonical URLs, match each URL
   * against the route's pattern, and yield the extracted params.
   */
  function staticParamsFor(typeName: string): () => Promise<Array<Record<string, string>>> {
    return async () => {
      if (!config.schema) {
        throw new Error(
          `staticParamsFor("${typeName}") requires \`schema\` to be passed to defineCms()`,
        )
      }
      const route = config.schema.routes?.find((r) => r.type === typeName)
      if (!route) return []
      const typeDef = config.schema.types.find((t) => t.name === typeName)
      if (!typeDef?.locations) return []

      const client = await buildClient()
      const docs = await client.fetch<Array<Record<string, unknown>>>(
        `*[_type == "${typeName}"]`,
      )

      const out: Array<Record<string, string>> = []
      for (const doc of docs) {
        const locs = typeDef.locations(doc)
        for (const loc of locs) {
          const params = matchPatternStrict(route.pattern, loc.href)
          if (params) {
            out.push(params)
            break
          }
        }
      }
      return out
    }
  }

  return {
    getClient,
    buildClient,
    sanityFetch,
    DRAFT_ROUTES,
    VisualEditingBridge,
    staticParamsFor,
  }
}

// Match a pattern like "/posts/:slug" against "/posts/hello" → { slug: "hello" }
function matchPatternStrict(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === "*") return {}
  const patParts = pattern.replace(/\/$/, "").split("/")
  const pathParts = pathname.replace(/\/$/, "").split("/")
  if (patParts.length !== pathParts.length) return null
  const out: Record<string, string> = {}
  for (let i = 0; i < patParts.length; i++) {
    const p = patParts[i]!
    const v = pathParts[i]!
    if (p.startsWith(":")) out[p.slice(1)] = decodeURIComponent(v)
    else if (p !== v) return null
  }
  return out
}

// Silence unused var lint when consumers don't pull cookies directly
void cookies
