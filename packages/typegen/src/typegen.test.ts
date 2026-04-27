import { describe, expect, test } from "bun:test"
import { emitSchemaTypes, inferQueryType } from "@repo/typegen"
import { defineField, defineInlineType, defineSchema, defineType } from "@repo/core/schema"

const schema = defineSchema({
  types: [
    defineType({
      name: "author",
      title: "Author",
      type: "document",
      fields: [defineField({ name: "name", title: "Name", type: "string" })],
    }),
    defineType({
      name: "post",
      title: "Post",
      type: "document",
      fields: [
        defineField({ name: "title", title: "Title", type: "string" }),
        defineField({ name: "slug", title: "Slug", type: "slug" }),
        defineField({ name: "published", title: "Published", type: "boolean" }),
        defineField({ name: "author", title: "Author", type: "reference", to: ["author"] }),
      ],
    }),
    defineType({
      name: "page",
      title: "Page",
      type: "document",
      fields: [
        defineField({ name: "title", title: "Title", type: "string" }),
        defineField({
          name: "slices",
          title: "Slices",
          type: "array",
          of: [
            defineInlineType({
              typeName: "heroSlice",
              title: "Hero",
              fields: [
                defineField({ name: "heading", title: "Heading", type: "string" }),
                defineField({ name: "ctaHref", title: "CTA URL", type: "url" }),
              ],
            }),
            defineInlineType({
              typeName: "ctaSlice",
              title: "CTA",
              fields: [defineField({ name: "label", title: "Label", type: "string" })],
            }),
          ],
        }),
      ],
    }),
  ],
})

describe("emitSchemaTypes", () => {
  test("emits interfaces for every document type", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    expect(out).toContain("export interface Post extends SanityCloneDocument")
    expect(out).toContain("export interface Author extends SanityCloneDocument")
  })

  test("emits AnyDocument union", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    expect(out).toContain("export type AnyDocument = Author | Post")
  })

  test("emits DocumentByType map", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    expect(out).toContain("author: Author")
    expect(out).toContain("post: Post")
  })

  test("slug emits as { current: string }", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    expect(out).toMatch(/slug\?: \{ _type\?: "slug"; current: string \}/)
  })

  test("reference uses referenced _id union", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    expect(out).toContain('_ref: DocumentByType["author"]["_id"]')
  })
})

describe("inferQueryType", () => {
  test("bare type query → Post[]", () => {
    expect(inferQueryType('*[_type == "post"]', schema)).toBe("Post[]")
  })

  test("[0] index → Post | null", () => {
    expect(inferQueryType('*[_type == "post"][0]', schema)).toBe("Post | null")
  })

  test("projection of known fields → Pick<Post, ...>", () => {
    expect(inferQueryType('*[_type == "post"]{title, published}', schema)).toBe(
      'Pick<Post, "title" | "published">[]',
    )
  })

  test("renamed slug path → string", () => {
    const t = inferQueryType('*[_type == "post"]{"slug": slug.current}', schema)
    expect(t).toContain("slug: string")
  })

  test("reference dereference → projected target type", () => {
    const t = inferQueryType('*[_type == "post"][0]{"author": author->{name}}', schema)
    expect(t).toContain('author: Pick<Author, "name"> | null')
  })

  test("builtin _id counts as known → Pick with _id works", () => {
    const t = inferQueryType('*[_type == "post"]{_id, title}', schema)
    // _id is on SanityCloneDocument which Post extends, so Pick<Post, "_id" | "title"> is valid TS
    expect(t).toBe('Pick<Post, "_id" | "title">[]')
  })

  test("unknown fields fall out of Pick mode → object literal with unknown", () => {
    const t = inferQueryType('*[_type == "post"]{notAField}', schema)
    expect(t).toContain("notAField: unknown")
  })

  test("count() → number", () => {
    expect(inferQueryType('count(*[_type == "post"])', schema)).toBe("number")
  })

  test("[0..n] slice → array, not single", () => {
    expect(inferQueryType('*[_type == "post"][0..2]', schema)).toBe("Post[]")
  })

  test("| order(...) doesn't change type shape", () => {
    expect(inferQueryType('*[_type == "post"] | order(title asc)', schema)).toBe("Post[]")
  })
})

describe("emitSchemaTypes — inline types + slices", () => {
  test("emits discriminated _type + _key in array.of union members", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    // The Page.slices field should include each slice with its discriminator
    expect(out).toContain('_type: "heroSlice"; _key: string')
    expect(out).toContain('_type: "ctaSlice"; _key: string')
  })

  test("emits named aliases for every inline object type in the schema", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    expect(out).toContain("export interface HeroSlice {")
    expect(out).toContain("export interface CtaSlice {")
    // Each alias carries its own `_type` literal
    expect(out).toMatch(/export interface HeroSlice \{[^}]*_type: "heroSlice"/s)
  })

  test("named aliases include all declared fields", () => {
    const out = emitSchemaTypes(schema, { includeHeader: false })
    expect(out).toMatch(/export interface HeroSlice \{[^}]*heading\?: string[^}]*ctaHref\?: string/s)
  })
})
