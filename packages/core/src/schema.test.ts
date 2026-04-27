import { describe, expect, test } from "bun:test"
import {
  defineField,
  defineInlineType,
  defineSchema,
  defineType,
  deserializeSchema,
  matchRoute,
  serializeSchema,
} from "@repo/core/schema"

const schema = defineSchema({
  types: [
    defineType({
      name: "post",
      title: "Post",
      type: "document",
      fields: [
        defineField({ name: "title", title: "Title", type: "string" }),
        defineField({ name: "slug", title: "Slug", type: "slug" }),
        defineField({
          name: "slices",
          title: "Slices",
          type: "array",
          of: [
            defineInlineType({
              typeName: "heroSlice",
              title: "Hero",
              fields: [defineField({ name: "heading", title: "H", type: "string" })],
            }),
          ],
        }),
      ],
      preview: { select: { title: "title" } },
      locations: (doc) => {
        const slug = (doc as { slug?: { current?: string } }).slug?.current
        return slug ? [{ title: "Post", href: `/posts/${slug}` }] : []
      },
    }),
  ],
  routes: [
    {
      pattern: "/posts/:slug",
      type: "post",
      resolve: (params) => ({
        filter: '*[_type == "post" && slug.current == $slug][0]',
        params: { slug: params.slug },
      }),
    },
  ],
})

describe("serializeSchema", () => {
  test("strips resolve() functions from routes", () => {
    const s = serializeSchema(schema)
    expect(s.routes).toEqual([{ pattern: "/posts/:slug", type: "post" }])
    // Should be JSON.stringify-able without losing anything
    const json = JSON.stringify(s)
    expect(json).toContain('"pattern":"/posts/:slug"')
  })

  test("strips locations() callbacks from types", () => {
    const s = serializeSchema(schema)
    const post = s.types.find((t) => t.name === "post")!
    // No function properties survive
    expect(typeof (post as { locations?: unknown }).locations).not.toBe("function")
  })

  test("preserves inline object fields inside array.of recursively", () => {
    const s = serializeSchema(schema)
    const post = s.types.find((t) => t.name === "post")!
    const slices = post.fields.find((f) => f.name === "slices")!
    expect(slices.type).toBe("array")
    const of = (slices as { of: { type: string; typeName?: string }[] }).of
    expect(of[0]!.type).toBe("object")
    expect(of[0]!.typeName).toBe("heroSlice")
  })

  test("is round-trippable via deserializeSchema", () => {
    const s = serializeSchema(schema)
    const back = deserializeSchema(s)
    // Same types, same names
    expect(back.types.map((t) => t.name)).toEqual(schema.types.map((t) => t.name))
    // Routes come back with a no-op resolve()
    expect(back.routes?.[0]!.pattern).toBe("/posts/:slug")
    expect(typeof back.routes?.[0]!.resolve).toBe("function")
  })

  test("serialized form is pure JSON (survives structuredClone)", () => {
    const s = serializeSchema(schema)
    const cloned = JSON.parse(JSON.stringify(s))
    expect(cloned).toEqual(s as unknown as Record<string, unknown>)
  })
})

describe("matchRoute", () => {
  test("matches a static segment + a :param", () => {
    const m = matchRoute(schema, "/posts/hello-world")
    expect(m).not.toBeNull()
    expect(m!.route.type).toBe("post")
    expect(m!.params.slug).toBe("hello-world")
  })

  test("returns null when pattern doesn't match", () => {
    expect(matchRoute(schema, "/authors/foo")).toBeNull()
  })

  test("URL-decodes param values", () => {
    const m = matchRoute(schema, "/posts/hello%20world")
    expect(m!.params.slug).toBe("hello world")
  })

  test("empty routes: returns null", () => {
    const noRoutes = defineSchema({ types: schema.types, routes: [] })
    expect(matchRoute(noRoutes, "/posts/anything")).toBeNull()
  })
})
