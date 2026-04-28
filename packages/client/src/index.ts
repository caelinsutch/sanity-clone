/**
 * The Sanity-like HTTP client.
 *
 * Mirrors a tiny subset of `@sanity/client`:
 *   - `client.fetch(query, params)` returns query results
 *   - `client.mutate(mutations)` applies mutations
 *   - `client.withConfig(...)` returns a new client with merged options
 *   - Stega encoding is applied automatically when enabled (drafts mode)
 *
 * Layer 4 (data loading) lives in `createLiveStore()` which subscribes to
 * Server-Sent Events from the API and re-fetches on mutations.
 */

import type { Mutation, MutationResult, Perspective, SanityDocument } from "@repo/core"
import type { ContentSourceMap } from "@repo/core/csm"
import { encodeResultWithCsm, stegaClean, type StegaOptions } from "./stega"

export interface ClientConfig {
  /** Base URL of the API, e.g. http://localhost:8787 */
  apiUrl: string
  dataset: string
  /** Auth token, required for drafts / mutations. */
  token?: string
  useCdn?: boolean
  perspective?: Perspective
  stega?: { enabled: boolean; studioUrl?: string; filter?: StegaOptions["filter"] }
  /**
   * Override the `fetch` implementation. Useful on Cloudflare Workers where
   * a service binding to the API worker avoids the subrequest loop that same-
   * subdomain `workers.dev` calls hit. Defaults to global `fetch`.
   */
  fetcher?: typeof fetch
}

export interface FetchOptions {
  perspective?: Perspective
  /** Per-request stega override. */
  stega?: boolean
  /** If false, return { result, resultSourceMap, ms }. If true (default), return just result. */
  filterResponse?: boolean
  /**
   * Next.js-friendly caching hints, forwarded to the underlying `fetch()`.
   * Other runtimes harmlessly ignore them.
   *
   *   cache:   "force-cache" | "no-store" | ...
   *   next:    { revalidate?: number | false; tags?: string[] }
   */
  cache?: RequestCache
  next?: { revalidate?: number | false; tags?: string[] }
}

export class SanityCloneClient {
  constructor(public readonly config: ClientConfig) {}

  withConfig(partial: Partial<ClientConfig>): SanityCloneClient {
    return new SanityCloneClient({
      ...this.config,
      ...partial,
      stega: { ...this.config.stega, ...partial.stega } as ClientConfig["stega"],
    })
  }

  async fetch<T = unknown>(query: string, params: Record<string, unknown> = {}, options: FetchOptions = {}): Promise<T> {
    const perspective = options.perspective ?? this.config.perspective ?? "published"
    const url = new URL(`/v1/data/query/${encodeURIComponent(this.config.dataset)}`, this.config.apiUrl)
    url.searchParams.set("query", query)
    url.searchParams.set("perspective", perspective)
    // Clean stega encoding from params so a previous result can't corrupt this one
    for (const [k, v] of Object.entries(stegaClean(params))) {
      url.searchParams.set(`$${k}`, JSON.stringify(v))
    }
    url.searchParams.set("resultSourceMap", "true")

    const f = this.config.fetcher ?? fetch
    const res = await f(url.toString(), {
      headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {},
      ...(options.cache ? { cache: options.cache } : {}),
      // Next.js reads `next` on the init object; runtimes without it ignore.
      ...(options.next ? ({ next: options.next } as RequestInit & { next: unknown }) : {}),
    })
    if (!res.ok) throw new Error(`Query failed: ${res.status} ${await res.text()}`)
    const body = (await res.json()) as { result: T; resultSourceMap?: ContentSourceMap; ms?: number }

    // Stega on/off for this request
    const stegaOn = options.stega ?? this.config.stega?.enabled ?? false
    let result = body.result
    if (stegaOn && body.resultSourceMap && this.config.stega?.studioUrl) {
      result = encodeResultWithCsm(result, body.resultSourceMap, {
        studioUrl: this.config.stega.studioUrl,
        filter: this.config.stega?.filter,
      })
    }

    if (options.filterResponse === false) {
      return { result, resultSourceMap: body.resultSourceMap, ms: body.ms } as unknown as T
    }
    return result
  }

  async mutate(mutations: Mutation[]): Promise<MutationResult> {
    const url = new URL(`/v1/data/mutate/${encodeURIComponent(this.config.dataset)}`, this.config.apiUrl)
    const f = this.config.fetcher ?? fetch
    const res = await f(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
      },
      body: JSON.stringify({ mutations }),
    })
    if (!res.ok) throw new Error(`Mutate failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as MutationResult
  }

  async getDocument(id: string): Promise<SanityDocument | null> {
    const url = new URL(`/v1/data/doc/${encodeURIComponent(this.config.dataset)}/${encodeURIComponent(id)}`, this.config.apiUrl)
    const f = this.config.fetcher ?? fetch
    const res = await f(url.toString(), {
      headers: this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {},
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Get doc failed: ${res.status}`)
    const body = (await res.json()) as { documents: SanityDocument[] }
    return body.documents[0] ?? null
  }

  /**
   * Subscribe to a GROQ query and get live updates when documents mutate.
   * Uses Server-Sent Events backed by the API's `/listen` endpoint.
   */
  listen(
    query: string,
    params: Record<string, unknown> = {},
    handler: (result: unknown) => void,
    options: FetchOptions = {},
  ): () => void {
    let closed = false
    const run = async () => {
      try {
        handler(await this.fetch(query, params, options))
      } catch (e) {
        // swallow — the subscriber can refetch manually
        console.warn("[client.listen] fetch failed", e)
      }
    }
    run()
    const url = new URL(`/v1/data/listen/${encodeURIComponent(this.config.dataset)}`, this.config.apiUrl)
    const es = new EventSource(url.toString(), { withCredentials: false })
    es.addEventListener("mutation", () => {
      if (!closed) run()
    })
    es.onerror = () => {
      /* auto-reconnect by EventSource */
    }
    return () => {
      closed = true
      es.close()
    }
  }
}

export function createClient(config: ClientConfig): SanityCloneClient {
  return new SanityCloneClient(config)
}

export { stegaClean } from "./stega"
export type { StegaOptions } from "./stega"
