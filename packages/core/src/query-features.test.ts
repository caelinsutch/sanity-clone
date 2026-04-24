import { describe, expect, test } from "bun:test"
import { executeQuery, parseQuery } from "@repo/core/query"
import type { SanityDocument } from "@repo/core"

const docs: SanityDocument[] = [
  {
    _id: "post-1",
    _type: "post",
    _rev: "r1",
    _createdAt: "2024-01-01",
    _updatedAt: "2024-03-10",
    title: "Alpha",
    slug: { current: "alpha" },
    views: 10,
    published: true,
  },
  {
    _id: "post-2",
    _type: "post",
    _rev: "r2",
    _createdAt: "2024-02-01",
    _updatedAt: "2024-02-15",
    title: "Beta",
    slug: { current: "beta" },
    views: 30,
    published: false,
  },
  {
    _id: "post-3",
    _type: "post",
    _rev: "r3",
    _createdAt: "2024-03-01",
    _updatedAt: "2024-04-01",
    title: "Gamma",
    slug: { current: "gamma" },
    views: 20,
    published: true,
  },
]

describe("order()", () => {
  test("order(title asc)", () => {
    const { result } = executeQuery(docs, '*[_type == "post"] | order(title asc){title}')
    expect((result as { title: string }[]).map((r) => r.title)).toEqual(["Alpha", "Beta", "Gamma"])
  })

  test("order(title desc)", () => {
    const { result } = executeQuery(docs, '*[_type == "post"] | order(title desc){title}')
    expect((result as { title: string }[]).map((r) => r.title)).toEqual(["Gamma", "Beta", "Alpha"])
  })

  test("order(views desc) sorts by number", () => {
    const { result } = executeQuery(docs, '*[_type == "post"] | order(views desc){views}')
    expect((result as { views: number }[]).map((r) => r.views)).toEqual([30, 20, 10])
  })

  test("multi-key order falls through on ties", () => {
    const { result } = executeQuery(
      [
        ...docs,
        {
          _id: "post-4",
          _type: "post",
          _rev: "",
          _createdAt: "",
          _updatedAt: "",
          title: "Alpha",
          slug: { current: "alpha-2" },
          views: 5,
        } as SanityDocument,
      ],
      '*[_type == "post"] | order(title asc, views desc){title, views}',
    )
    const out = (result as { title: string; views: number }[]).map((r) => [r.title, r.views])
    // Two "Alpha" docs — the one with more views comes first
    expect(out).toEqual([
      ["Alpha", 10],
      ["Alpha", 5],
      ["Beta", 30],
      ["Gamma", 20],
    ])
  })
})

describe("slicing", () => {
  test("[0..1] inclusive", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post"] | order(title asc)[0..1]{title}',
    )
    expect((result as { title: string }[]).map((r) => r.title)).toEqual(["Alpha", "Beta"])
  })

  test("[0...2] exclusive end", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post"] | order(title asc)[0...2]{title}',
    )
    expect((result as { title: string }[]).map((r) => r.title)).toEqual(["Alpha", "Beta"])
  })

  test("[1..100] clamps to available", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post"] | order(title asc)[1..100]{title}',
    )
    expect((result as { title: string }[]).map((r) => r.title)).toEqual(["Beta", "Gamma"])
  })
})

describe("count()", () => {
  test("count of a filter", () => {
    const { result } = executeQuery(docs, 'count(*[_type == "post"])')
    expect(result).toBe(3)
  })

  test("count with a filter clause", () => {
    const { result } = executeQuery(docs, 'count(*[_type == "post" && published == true])')
    expect(result).toBe(2)
  })
})

describe("|| (OR) and parens in filters", () => {
  test("simple or", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && (title == "Alpha" || title == "Gamma")]{title}',
    )
    expect((result as { title: string }[]).map((r) => r.title).sort()).toEqual(["Alpha", "Gamma"])
  })

  test("precedence: and binds tighter than or", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && views > 15 || title == "Alpha"]{title}',
    )
    expect(
      (result as { title: string }[]).map((r) => r.title).sort(),
    ).toEqual(["Alpha", "Beta", "Gamma"])
  })
})

describe("comparison operators", () => {
  test("> and <", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && views > 15]{title}',
    )
    expect((result as { title: string }[]).map((r) => r.title).sort()).toEqual(["Beta", "Gamma"])
  })

  test(">= and <=", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && views >= 20 && views <= 30]{title}',
    )
    expect((result as { title: string }[]).map((r) => r.title).sort()).toEqual(["Beta", "Gamma"])
  })

  test("!=", () => {
    const { result } = executeQuery(docs, '*[_type == "post" && title != "Alpha"]{title}')
    expect((result as { title: string }[]).map((r) => r.title).sort()).toEqual(["Beta", "Gamma"])
  })
})

describe("match (wildcard string matching)", () => {
  test("match with *-wildcard is case-insensitive", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && title match "alp*"]{title}',
    )
    expect((result as { title: string }[])).toEqual([{ title: "Alpha" }])
  })
})

describe("combined pipeline", () => {
  test("filter + order + slice + projection", () => {
    const { result } = executeQuery(
      docs,
      '*[_type == "post" && published == true] | order(views desc)[0..0]{title, views}',
    )
    expect(result).toEqual([{ title: "Gamma", views: 20 }])
  })
})
