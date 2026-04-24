/**
 * API integration tests — exercise the Hono app directly using a fake KV.
 *
 * We construct a minimal KV shim that implements the subset of KVNamespace
 * used by `store.ts` (get, put, delete, list), back it with an in-memory
 * Map, and hand it to the Hono app via its `fetch(request, env)` call
 * signature. No network, no wrangler needed.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import app from "./index"
import type { Env } from "./store"
import type { SanityDocument } from "@repo/core"

class FakeKV {
  private store = new Map<string, string>()

  async get(key: string, type?: "text" | "json"): Promise<unknown> {
    const v = this.store.get(key)
    if (v === undefined) return null
    if (type === "json") return JSON.parse(v)
    return v
  }
  async put(key: string, value: string, _options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value)
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }
  async list(options: { prefix?: string; cursor?: string } = {}): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }> {
    const keys = [...this.store.keys()]
      .filter((k) => (options.prefix ? k.startsWith(options.prefix) : true))
      .map((name) => ({ name }))
    return { keys, list_complete: true }
  }
}

const SEED: SanityDocument[] = [
  {
    _id: "siteSettings",
    _type: "siteSettings",
    _rev: "r1",
    _createdAt: "2024-01-01",
    _updatedAt: "2024-01-01",
    title: "Test Site",
    tagline: "Testing 1 2 3",
  },
  {
    _id: "author-jane",
    _type: "author",
    _rev: "r2",
    _createdAt: "2024-01-01",
    _updatedAt: "2024-01-01",
    name: "Jane Doe",
  },
  {
    _id: "post-hello",
    _type: "post",
    _rev: "r3",
    _createdAt: "2024-01-01",
    _updatedAt: "2024-01-01",
    title: "Hello",
    slug: { current: "hello" },
    body: "World",
    author: { _type: "reference", _ref: "author-jane" },
  },
]

function makeEnv(): Env {
  const kv = new FakeKV()
  return {
    CONTENT: kv as unknown as KVNamespace,
    ADMIN_TOKEN: "test-token",
    ALLOWED_ORIGINS: "http://localhost:3000",
  }
}

async function seed(env: Env, dataset = "test") {
  const res = await app.fetch(
    new Request(`http://api/v1/data/seed/${dataset}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({ documents: SEED }),
    }),
    env,
  )
  expect(res.status).toBe(200)
}

describe("GET /v1/health", () => {
  test("returns ok:true", async () => {
    const env = makeEnv()
    const res = await app.fetch(new Request("http://api/v1/health"), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})

describe("seed + query + doc endpoints", () => {
  let env: Env
  beforeEach(() => {
    env = makeEnv()
  })

  test("seed refuses without admin token", async () => {
    const res = await app.fetch(
      new Request("http://api/v1/data/seed/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documents: SEED }),
      }),
      env,
    )
    expect(res.status).toBe(403)
  })

  test("seed + query roundtrip", async () => {
    await seed(env)
    const url = new URL("http://api/v1/data/query/test")
    url.searchParams.set("query", '*[_type == "post"]{title}')
    const res = await app.fetch(new Request(url.toString()), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { result: { title: string }[] }
    expect(body.result).toEqual([{ title: "Hello" }])
  })

  test("query with $-prefixed params", async () => {
    await seed(env)
    const url = new URL("http://api/v1/data/query/test")
    url.searchParams.set(
      "query",
      '*[_type == "post" && slug.current == $slug][0]{title}',
    )
    url.searchParams.set("$slug", '"hello"')
    const res = await app.fetch(new Request(url.toString()), env)
    const body = (await res.json()) as { result: { title: string } | null }
    expect(body.result).toEqual({ title: "Hello" })
  })

  test("query returns Content Source Map when requested", async () => {
    await seed(env)
    const url = new URL("http://api/v1/data/query/test")
    url.searchParams.set("query", '*[_type == "post"]{title}')
    url.searchParams.set("resultSourceMap", "true")
    const res = await app.fetch(new Request(url.toString()), env)
    const body = (await res.json()) as { resultSourceMap?: { documents: unknown[] } }
    expect(body.resultSourceMap).toBeDefined()
    expect(body.resultSourceMap!.documents.length).toBeGreaterThan(0)
  })

  test("doc endpoint returns a single document", async () => {
    await seed(env)
    const res = await app.fetch(
      new Request("http://api/v1/data/doc/test/post-hello"),
      env,
    )
    const body = (await res.json()) as { documents: SanityDocument[] }
    expect(body.documents[0]?._id).toBe("post-hello")
  })

  test("doc endpoint 404s for missing id", async () => {
    const res = await app.fetch(new Request("http://api/v1/data/doc/test/nope"), env)
    expect(res.status).toBe(404)
  })
})

describe("mutations", () => {
  let env: Env
  beforeEach(async () => {
    env = makeEnv()
    await seed(env)
  })

  test("patch updates a field and bumps _rev", async () => {
    const before = await app.fetch(
      new Request("http://api/v1/data/doc/test/post-hello"),
      env,
    )
    const beforeDoc = ((await before.json()) as { documents: SanityDocument[] }).documents[0]!

    const res = await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [{ patch: { id: "post-hello", set: { title: "Patched" } } }],
        }),
      }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: { document: SanityDocument }[] }
    expect(body.results[0]?.document.title).toBe("Patched")
    expect(body.results[0]?.document._rev).not.toBe(beforeDoc._rev)
  })

  test("ifRevisionID mismatch rejects the mutation", async () => {
    const res = await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [
            {
              patch: {
                id: "post-hello",
                set: { title: "Nope" },
                ifRevisionID: "wrong",
              },
            },
          ],
        }),
      }),
      env,
    )
    expect(res.status).toBe(409)
  })

  test("create + delete roundtrip", async () => {
    const create = await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [
            {
              create: {
                _id: "drafts.post-new",
                _type: "post",
                title: "New",
                slug: { current: "new" },
              },
            },
          ],
        }),
      }),
      env,
    )
    expect(create.status).toBe(200)

    const del = await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [{ delete: { id: "drafts.post-new" } }],
        }),
      }),
      env,
    )
    expect(del.status).toBe(200)

    const after = await app.fetch(
      new Request("http://api/v1/data/doc/test/drafts.post-new"),
      env,
    )
    expect(after.status).toBe(404)
  })
})

describe("perspectives + publish flow", () => {
  let env: Env
  beforeEach(async () => {
    env = makeEnv()
    await seed(env)
  })

  test("drafts perspective hides published when draft exists", async () => {
    // Create a draft of post-hello with a different title
    await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [
            {
              createOrReplace: {
                _id: "drafts.post-hello",
                _type: "post",
                title: "Draft title",
                slug: { current: "hello" },
              },
            },
          ],
        }),
      }),
      env,
    )

    // Published perspective: old title
    const pub = new URL("http://api/v1/data/query/test")
    pub.searchParams.set("query", '*[_type == "post"][0]{title}')
    pub.searchParams.set("perspective", "published")
    const pubBody = (await (await app.fetch(new Request(pub.toString()), env)).json()) as {
      result: { title: string }
    }
    expect(pubBody.result.title).toBe("Hello")

    // Drafts perspective: new title
    const drafts = new URL("http://api/v1/data/query/test")
    drafts.searchParams.set("query", '*[_type == "post"][0]{title}')
    drafts.searchParams.set("perspective", "drafts")
    const draftBody = (await (await app.fetch(new Request(drafts.toString()), env)).json()) as {
      result: { title: string }
    }
    expect(draftBody.result.title).toBe("Draft title")
  })

  test("publish promotes draft → published and removes draft", async () => {
    // Create a draft
    await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [
            {
              createOrReplace: {
                _id: "drafts.post-hello",
                _type: "post",
                title: "About to publish",
                slug: { current: "hello" },
                body: "Body content long enough for validation.",
                author: { _type: "reference", _ref: "author-jane" },
              },
            },
          ],
        }),
      }),
      env,
    )

    const res = await app.fetch(
      new Request("http://api/v1/data/publish/test/post-hello", { method: "POST" }),
      env,
    )
    expect(res.status).toBe(200)

    // Draft is gone, published has the new title
    const draft = await app.fetch(
      new Request("http://api/v1/data/doc/test/drafts.post-hello"),
      env,
    )
    expect(draft.status).toBe(404)

    const pub = await app.fetch(new Request("http://api/v1/data/doc/test/post-hello"), env)
    const pubBody = (await pub.json()) as { documents: SanityDocument[] }
    expect(pubBody.documents[0]?.title).toBe("About to publish")
  })
})

describe("validation on publish", () => {
  let env: Env
  beforeEach(() => {
    env = makeEnv()
  })

  test("publish rejects an invalid draft with 422", async () => {
    // Seed only the site settings + author (so references resolve)
    await app.fetch(
      new Request("http://api/v1/data/seed/test", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({
          documents: [
            {
              _id: "author-jane",
              _type: "author",
              name: "Jane",
            },
          ],
        }),
      }),
      env,
    )

    // Create a draft post that's missing required fields (no title, no body, no slug)
    await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [
            {
              createOrReplace: {
                _id: "drafts.post-bad",
                _type: "post",
                // no title, no body, no slug
              },
            },
          ],
        }),
      }),
      env,
    )

    const res = await app.fetch(
      new Request("http://api/v1/data/publish/test/post-bad", { method: "POST" }),
      env,
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string; issues: { path: string }[] }
    expect(body.error).toBe("validation")
    const paths = body.issues.map((i) => i.path).sort()
    // title, slug, body, and author are all required
    expect(paths).toContain("title")
    expect(paths).toContain("slug")
    expect(paths).toContain("body")
    expect(paths).toContain("author")
  })

  test("publish accepts a valid draft", async () => {
    await app.fetch(
      new Request("http://api/v1/data/seed/test", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({
          documents: [{ _id: "author-jane", _type: "author", name: "Jane" }],
        }),
      }),
      env,
    )

    await app.fetch(
      new Request("http://api/v1/data/mutate/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mutations: [
            {
              createOrReplace: {
                _id: "drafts.post-good",
                _type: "post",
                title: "Valid Post",
                slug: { current: "valid-post" },
                body: "Long enough body content.",
                author: { _type: "reference", _ref: "author-jane" },
              },
            },
          ],
        }),
      }),
      env,
    )

    const res = await app.fetch(
      new Request("http://api/v1/data/publish/test/post-good", { method: "POST" }),
      env,
    )
    expect(res.status).toBe(200)
  })
})

describe("CORS", () => {
  test("Access-Control-Allow-Origin mirrors an allowed origin", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      new Request("http://api/v1/health", {
        headers: { origin: "http://localhost:3000" },
      }),
      env,
    )
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  })
})
