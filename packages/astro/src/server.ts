/**
 * Server-side half of `@repo/astro`.
 *
 * Mirrors `@repo/next/server` but for Astro:
 *   - `getClient(cookies)` — draft-aware client (cookie-driven)
 *   - `sanityFetch(cookies, query, params)` — thin convenience wrapper
 *   - `draftRoutes` — Astro `APIRoute` handlers for
 *     `/api/draft/enable`, `/api/draft/disable`, `/api/revalidate`
 *   - `isDraftMode(cookies)` — cookie helper
 *
 * Unlike Next, Astro has no built-in tag-based cache. Revalidation on
 * Cloudflare Workers is handled at the edge cache level: the webhook
 * payload carries the tags, and a paired `getCacheKeys()` helper lets
 * consumers purge Cache API entries if they've opted into caching.
 */

import { createClient, type FetchOptions } from "@repo/client"
import type { Schema } from "@repo/core/schema"

// Imported lazily to keep this file usable in non-Astro contexts (tests).
type AstroCookies = {
  get(name: string): { value: string } | undefined
  set(name: string, value: string, options?: Record<string, unknown>): void
  delete(name: string, options?: Record<string, unknown>): void
}
type APIContext = {
  cookies: AstroCookies
  url: URL
  request: Request
  redirect: (location: string, status?: number) => Response
  // Cloudflare-only at runtime
  locals?: {
    runtime?: {
      env?: Record<string, unknown>
    }
  }
}

export interface AstroCmsConfig {
  apiUrl: string
  dataset: string
  studioUrl: string
  /**
   * Optional project id. Forwarded to the client so stega intent URLs
   * target the correct project workspace in the Studio.
   */
  projectId?: string
  /** Server-only read token used when in draft mode. */
  token?: string
  /** Shared secret the API webhook must include. */
  revalidateSecret?: string
  schema?: Schema
  /** Cookie name that marks draft mode. Defaults to `sanity-clone-draft`. */
  draftCookieName?: string
}

export interface ConfiguredAstroCms {
  getClient: (ctx: APIContext) => ReturnType<typeof createClient>
  buildClient: (ctx?: APIContext) => ReturnType<typeof createClient>
  sanityFetch: <T = unknown>(
    ctx: APIContext,
    query: string,
    params?: Record<string, unknown>,
    options?: FetchOptions,
  ) => Promise<T>
  isDraftMode: (ctx: APIContext) => boolean
  draftRoutes: {
    enable: (ctx: APIContext) => Promise<Response> | Response
    disable: (ctx: APIContext) => Promise<Response> | Response
    revalidate: (ctx: APIContext) => Promise<Response>
  }
  /**
   * Return an `async function getStaticPaths()` for a given document type.
   * Use from an Astro dynamic route:
   *
   *   export const getStaticPaths = cms.staticPathsFor("post")
   */
  staticPathsFor: (typeName: string) => () => Promise<Array<{ params: Record<string, string> }>>
}

export function defineAstroCms(config: AstroCmsConfig): ConfiguredAstroCms {
  const cookieName = config.draftCookieName ?? "sanity-clone-draft"

  function resolveFetcher(ctx?: APIContext): typeof fetch | undefined {
    const binding = ctx?.locals?.runtime?.env?.API as
      | {
          fetch: (req: Request | string, init?: RequestInit) => Promise<Response>
        }
      | undefined
    if (binding && typeof binding.fetch === "function") {
      const bound = binding.fetch.bind(binding)
      return ((input, init) => bound(input as Request | string, init as RequestInit)) as typeof fetch
    }
    return undefined
  }

  function isDraftMode(ctx: APIContext): boolean {
    return ctx.cookies.get(cookieName)?.value === "1"
  }

  function getClient(ctx: APIContext) {
    const draft = isDraftMode(ctx)
    return createClient({
      apiUrl: config.apiUrl,
      dataset: config.dataset,
      projectId: config.projectId,
      perspective: draft ? "drafts" : "published",
      token: draft ? config.token : undefined,
      stega: { enabled: draft, studioUrl: config.studioUrl },
      fetcher: resolveFetcher(ctx),
    })
  }

  function buildClient(ctx?: APIContext) {
    return createClient({
      apiUrl: config.apiUrl,
      dataset: config.dataset,
      projectId: config.projectId,
      perspective: "published",
      stega: { enabled: false, studioUrl: config.studioUrl },
      fetcher: resolveFetcher(ctx),
    })
  }

  async function sanityFetch<T>(
    ctx: APIContext,
    query: string,
    params: Record<string, unknown> = {},
    options: FetchOptions = {},
  ): Promise<T> {
    const client = getClient(ctx)
    return client.fetch<T>(query, params, options)
  }

  const draftRoutes = {
    enable(ctx: APIContext) {
      const redirect = ctx.url.searchParams.get("redirect") ?? "/"
      ctx.cookies.set(cookieName, "1", {
        path: "/",
        httpOnly: true,
        secure: ctx.url.protocol === "https:",
        sameSite: "none",
      })
      return ctx.redirect(redirect, 307)
    },
    disable(ctx: APIContext) {
      const redirect = ctx.url.searchParams.get("redirect") ?? "/"
      ctx.cookies.delete(cookieName, { path: "/" })
      return ctx.redirect(redirect, 307)
    },
    async revalidate(ctx: APIContext) {
      const got = ctx.request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      if (config.revalidateSecret && got !== config.revalidateSecret) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      }
      let body: { tags?: string[] } = {}
      try {
        body = (await ctx.request.json()) as { tags?: string[] }
      } catch {
        /* empty */
      }
      // Astro's Cloudflare runtime doesn't expose per-tag cache invalidation.
      // Published pages are rendered per-request (SSR) or rebuilt at deploy
      // time (SSG); for SSR routes the draft-mode bypass makes revalidation
      // unnecessary on the preview side. Consumers that add an edge cache
      // (e.g., `Cache-Control: s-maxage=...`) can read the tag list off
      // `ctx.request.clone()` and purge via their own mechanism.
      return new Response(JSON.stringify({ revalidated: true, tags: body.tags ?? [] }), {
        headers: { "content-type": "application/json" },
      })
    },
  }

  function staticPathsFor(typeName: string) {
    return async () => {
      if (!config.schema) {
        throw new Error(`staticPathsFor("${typeName}") requires \`schema\` on defineAstroCms()`)
      }
      const route = config.schema.routes?.find((r) => r.type === typeName)
      if (!route) return []
      const typeDef = config.schema.types.find((t) => t.name === typeName)
      if (!typeDef?.locations) return []

      const client = buildClient()
      const docs = await client.fetch<Array<Record<string, unknown>>>(
        `*[_type == "${typeName}"]`,
      )

      const out: Array<{ params: Record<string, string> }> = []
      for (const doc of docs) {
        const locs = typeDef.locations(doc)
        for (const loc of locs) {
          const params = matchPatternStrict(route.pattern, loc.href)
          if (params) {
            out.push({ params })
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
    isDraftMode,
    draftRoutes,
    staticPathsFor,
  }
}

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
