import { describe, expect, test } from "bun:test"
import { executeQuery, parseQuery } from "@repo/core/query"
import type { SanityDocument } from "@repo/core"

const docs: SanityDocument[] = [
  {
    _id: "post-1",
    _type: "post",
    _rev: "r1",
    _createdAt: "2024-01-01",
    _updatedAt: "2024-01-01",
    title: "First",
    slug: { current: "first" },
    body: "Lorem",
    author: { _type: "reference", _ref: "author-jane" },
  },
  {
    _id: "post-2",
    _type: "post",
    _rev: "r2",
    _createdAt: "2024-01-02",
    _updatedAt: "2024-01-02",
    title: "Second",
    slug: { current: "second" },
    body: "Ipsum",
    author: { _type: "reference", _ref: "author-jane" },
  },
  {
    _id: "author-jane",
    _type: "author",
    _rev: "r3",
    _createdAt: "2024-01-01",
    _updatedAt: "2024-01-01",
    name: "Jane Doe",
    bio: "Writer",
  },
]

describe("parseQuery", () => {
  test("parses type filter", () => {
    const p = parseQuery('*[_type == "post"]')
    expect(p.typeFilter).toBe("post")
  })

  test("parses type filter + equality + parameter", () => {
    const p = parseQuery('*[_type == "post" && slug.current == $slug]')
    expect(p.typeFilter).toBe("post")
    expect(p.extraFilter).toBeDefined()
  })

  test("parses projection with bare fields", () => {
    const p = parseQuery('*[_type == "post"]{title, body}')
    expect(p.projection?.items).toHaveLength(2)
  })

  test("parses projection with renames + deref", () => {
    const p = parseQuery('*[_type == "post"]{title, "slug": slug.current, author->{name}}')
    expect(p.projection?.items).toHaveLength(3)
  })

  test("rejects unsupported queries with a helpful error", () => {
    expect(() => parseQuery("not a query")).toThrow()
  })
})

describe("executeQuery", () => {
  test("returns all docs of a type", () => {
    const { result } = executeQuery(docs, '*[_type == "post"]{_id, title}')
    expect(result).toEqual([
      { _id: "post-1", title: "First" },
      { _id: "post-2", title: "Second" },
    ])
  })

  test("applies equality filter on dotted paths via parameters", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && slug.current == $slug][0]{title}',
      { slug: "second" },
    )
    expect(result).toEqual({ title: "Second" })
  })

  test("[0] returns null when nothing matches", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && slug.current == $slug][0]',
      { slug: "nope" },
    )
    expect(result).toBeNull()
  })

  test("dereferences author->{name}", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && slug.current == "first"][0]{title, "author": author->{name}}',
    )
    expect(result).toEqual({ title: "First", author: { name: "Jane Doe" } })
  })

  test("deref returns null when target is missing", () => {
    const brokenDocs = [
      {
        _id: "p",
        _type: "post",
        _rev: "",
        _createdAt: "",
        _updatedAt: "",
        title: "x",
        author: { _type: "reference", _ref: "missing" },
      } as SanityDocument,
    ]
    const { result } = executeQuery(
      brokenDocs,
      '*[_type == "post"][0]{title, "author": author->{name}}',
    )
    expect(result).toEqual({ title: "x", author: null })
  })

  test("emits a Content Source Map", () => {
    const { resultSourceMap } = executeQuery(docs, '*[_type == "post"]{title}')
    expect(resultSourceMap).toBeDefined()
    expect(resultSourceMap!.documents.length).toBeGreaterThan(0)
    // Every projected title maps back to a source path
    expect(Object.keys(resultSourceMap!.mappings).length).toBeGreaterThan(0)
  })

  test("renamed dotted-path projection emits CSM for the source field", () => {
    const { result, resultSourceMap } = executeQuery(
      docs,
      '*[_type == "post" && slug.current == "first"][0]{"slug": slug.current}',
    )
    expect(result).toEqual({ slug: "first" })
    const mapping = resultSourceMap!.mappings["$['slug']"]
    expect(mapping).toBeDefined()
    expect(mapping?.source.type).toBe("documentValue")
  })
})
