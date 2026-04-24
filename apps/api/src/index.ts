/**
 * Cloudflare Workers Hono app — the Content Lake HTTP surface.
 *
 * Endpoints (subset of Sanity's HTTP API):
 *   GET  /v1/data/query/:dataset
 *   POST /v1/data/mutate/:dataset
 *   GET  /v1/data/doc/:dataset/:id
 *   GET  /v1/data/listen/:dataset   (SSE)
 *   POST /v1/data/seed/:dataset     (bootstrap seed, admin-gated)
 *   GET  /v1/health
 */

import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import type { Perspective, SanityDocument } from "@repo/core"
import { draftId, isDraftId, publishedId } from "@repo/core"
import { executeQuery } from "@repo/core/query"
import { getTypeDef } from "@repo/core/schema"
import { validateDocument } from "@repo/core/validate"
import { schema } from "@repo/schema"
import { applyMutations } from "./mutate.js"
import {
  currentSeq,
  getDoc,
  getEventsSince,
  listAllDocs,
  putDoc,
  type Env,
} from "./store.js"

type App = Hono<{ Bindings: Env }>
const app: App = new Hono()

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = (c.env.ALLOWED_ORIGINS ?? "").split(",").map((s: string) => s.trim()).filter(Boolean)
      if (!allowed.length || !origin) return "*"
      return allowed.includes(origin) ? origin : null
    },
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
)

function requireAdmin(c: Context<{ Bindings: Env }>): boolean {
  const auth = c.req.header("authorization") ?? ""
  const token = auth.replace(/^Bearer\s+/i, "")
  return token === c.env.ADMIN_TOKEN
}

app.get("/v1/health", (c) => c.json({ ok: true }))

// Resolve docs for a given perspective.
// - "published": strip any draft-only docs
// - "drafts": for each id, prefer the draft version, fall back to published
// - "raw": return everything as-is
function resolveDocsForPerspective(all: SanityDocument[], perspective: Perspective): SanityDocument[] {
  if (perspective === "raw") return all
  if (perspective === "published") {
    return all.filter((d) => !isDraftId(d._id))
  }
  // drafts
  const byPublishedId = new Map<string, SanityDocument>()
  for (const d of all) {
    const pid = publishedId(d._id)
    const existing = byPublishedId.get(pid)
    if (!existing) byPublishedId.set(pid, d)
    else if (isDraftId(d._id) && !isDraftId(existing._id)) byPublishedId.set(pid, d)
  }
  // Re-expose drafts as if they were the published doc (strip the prefix on _id)
  return [...byPublishedId.values()].map((d) =>
    isDraftId(d._id) ? { ...d, _id: publishedId(d._id), _originalId: d._id } : d,
  )
}

app.get("/v1/data/query/:dataset", async (c) => {
  const dataset = c.req.param("dataset")
  const query = c.req.query("query")
  if (!query) return c.json({ error: "Missing `query`" }, 400)
  const perspective = (c.req.query("perspective") ?? "published") as Perspective
  const wantCsm = c.req.query("resultSourceMap") === "true"

  // Gather params: any ?$name=JSON goes into params.name
  const params: Record<string, unknown> = {}
  for (const [k, v] of new URL(c.req.url).searchParams) {
    if (k.startsWith("$")) {
      try {
        params[k.slice(1)] = JSON.parse(v)
      } catch {
        params[k.slice(1)] = v
      }
    }
  }

  const all = await listAllDocs(c.env, dataset)
  const resolved = resolveDocsForPerspective(all, perspective)

  const start = Date.now()
  const { result, resultSourceMap } = executeQuery(resolved, query, params)
  const ms = Date.now() - start

  return c.json(wantCsm ? { result, resultSourceMap, ms } : { result, ms })
})

app.get("/v1/data/doc/:dataset/:id", async (c) => {
  const { dataset, id } = c.req.param()
  const doc = await getDoc(c.env, dataset, id)
  if (!doc) return c.json({ documents: [] }, 404)
  return c.json({ documents: [doc] })
})

app.post("/v1/data/mutate/:dataset", async (c) => {
  const dataset = c.req.param("dataset")
  const body = (await c.req.json()) as { mutations: Parameters<typeof applyMutations>[2] }
  if (!body?.mutations) return c.json({ error: "Missing mutations" }, 400)
  try {
    const result = await applyMutations(c.env, dataset, body.mutations)

    // Fire revalidation webhooks on every mutation. Per-slug tags let
    // consumers do fine-grained invalidation.
    const endpoints = (c.env.REVALIDATE_WEBHOOKS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (endpoints.length) {
      const tags = result.results
        .map((r) => {
          const doc = r.document as { _type?: string; slug?: { current?: string } } | undefined
          if (!doc) return null
          if (doc._type === "post" && doc.slug?.current) return `post:${doc.slug.current}`
          return null
        })
        .filter((t): t is string => !!t)
      const payload = JSON.stringify({ tags })
      const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${c.env.REVALIDATE_SECRET ?? ""}`,
      }
      for (const url of endpoints) {
        c.executionCtx.waitUntil(
          fetch(url, { method: "POST", headers, body: payload }).catch((e) =>
            console.warn("[revalidate] failed:", url, e),
          ),
        )
      }
    }
    return c.json(result)
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 409)
  }
})

// Server-sent events — re-emit `mutation` events as they occur.
app.get("/v1/data/listen/:dataset", async (c) => {
  const dataset = c.req.param("dataset")
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      let seq = await currentSeq(c.env, dataset)
      send("welcome", { seq })
      // Poll every 1s; workers support long-lived streams via `setTimeout`
      let closed = false
      const tick = async () => {
        if (closed) return
        try {
          const evs = await getEventsSince(c.env, dataset, seq)
          for (const ev of evs) {
            send("mutation", ev.event)
            seq = ev.seq
          }
          // keep-alive
          send("ping", { t: Date.now() })
        } catch (e) {
          send("error", { message: (e as Error).message })
        }
        setTimeout(tick, 1000)
      }
      setTimeout(tick, 1000)
      // Close on abort
      c.req.raw.signal.addEventListener("abort", () => {
        closed = true
        try {
          controller.close()
        } catch {
          /* ignore */
        }
      })
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  })
})

// Seed the dataset (admin-gated). Idempotent.
app.post("/v1/data/seed/:dataset", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "forbidden" }, 403)
  const dataset = c.req.param("dataset")
  const body = (await c.req.json()) as { documents: SanityDocument[] }
  const now = new Date().toISOString()
  for (const d of body.documents) {
    const existing = await getDoc(c.env, dataset, d._id)
    if (existing) continue
    const doc: SanityDocument = {
      ...d,
      _createdAt: now,
      _updatedAt: now,
      _rev: Math.random().toString(36).slice(2, 10),
    }
    await putDoc(c.env, dataset, doc)
  }
  return c.json({ ok: true, count: body.documents.length })
})

// List document ids — useful for the Studio sidebar.
app.get("/v1/data/list/:dataset", async (c) => {
  const dataset = c.req.param("dataset")
  const perspective = (c.req.query("perspective") ?? "drafts") as Perspective
  const type = c.req.query("type")
  const all = await listAllDocs(c.env, dataset)
  const resolved = resolveDocsForPerspective(all, perspective)
  const filtered = type ? resolved.filter((d) => d._type === type) : resolved
  return c.json({
    documents: filtered.map((d) => ({
      _id: d._id,
      _type: d._type,
      _updatedAt: d._updatedAt,
      title: (d as Record<string, unknown>).title ?? (d as Record<string, unknown>).name ?? d._id,
    })),
  })
})

// Publish / unpublish helpers (drafts.<id> <-> <id>)
app.post("/v1/data/publish/:dataset/:id", async (c) => {
  const { dataset, id } = c.req.param()
  const draft = await getDoc(c.env, dataset, draftId(id))
  if (!draft) return c.json({ error: "No draft to publish" }, 404)

  // Run validation against the schema before publishing.
  const typeDef = getTypeDef(schema, draft._type)
  if (typeDef) {
    const issues = validateDocument(typeDef, draft as Record<string, unknown>)
    const errors = issues.filter((i) => i.level === "error")
    if (errors.length > 0) {
      return c.json({ error: "validation", issues: errors }, 422)
    }
  }

  const published: SanityDocument = {
    ...draft,
    _id: publishedId(id),
    _updatedAt: new Date().toISOString(),
    _rev: Math.random().toString(36).slice(2, 10),
  }
  await putDoc(c.env, dataset, published)
  // Remove draft
  await c.env.CONTENT.delete(`doc:${dataset}:${draftId(id)}`)
  return c.json({ ok: true, published })
})

export default app
