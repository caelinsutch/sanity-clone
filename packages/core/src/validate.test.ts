import { describe, expect, test } from "bun:test"
import { validateDocument } from "@repo/core/validate"
import { defineField, defineType } from "@repo/core/schema"

const postType = defineType({
  name: "post",
  title: "Post",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: { required: true, min: 3, max: 80 },
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      validation: { required: true, pattern: "^[a-z0-9-]+$" },
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt",
      type: "text",
      validation: { max: 200 },
    }),
    defineField({
      name: "rating",
      title: "Rating",
      type: "number",
      validation: { min: 1, max: 5 },
    }),
    defineField({
      name: "status",
      title: "Status",
      type: "string",
      validation: { oneOf: ["draft", "published", "archived"] },
    }),
  ],
})

describe("validateDocument", () => {
  test("no issues on a fully-valid doc", () => {
    const issues = validateDocument(postType, {
      title: "Hello",
      slug: { current: "hello-world" },
      excerpt: "short",
      rating: 4,
      status: "draft",
    })
    expect(issues).toEqual([])
  })

  test("required field missing → error", () => {
    const issues = validateDocument(postType, { slug: { current: "x" } })
    expect(issues.find((i) => i.path === "title")?.level).toBe("error")
    expect(issues.find((i) => i.path === "title")?.message).toContain("required")
  })

  test("required field with whitespace-only value is empty", () => {
    const issues = validateDocument(postType, {
      title: "   ",
      slug: { current: "ok" },
    })
    expect(issues.find((i) => i.path === "title")).toBeDefined()
  })

  test("min length on string", () => {
    const issues = validateDocument(postType, {
      title: "Hi",
      slug: { current: "hi" },
    })
    expect(issues.find((i) => i.path === "title")?.message).toContain("at least 3")
  })

  test("max length on string", () => {
    const issues = validateDocument(postType, {
      title: "x".repeat(100),
      slug: { current: "x" },
    })
    expect(issues.find((i) => i.path === "title")?.message).toContain("at most 80")
  })

  test("pattern on slug", () => {
    const issues = validateDocument(postType, {
      title: "Hi!",
      slug: { current: "Has Spaces!" },
    })
    expect(issues.find((i) => i.path === "slug")).toBeDefined()
  })

  test("number range", () => {
    const tooLow = validateDocument(postType, {
      title: "Ok",
      slug: { current: "ok" },
      rating: 0,
    })
    expect(tooLow.find((i) => i.path === "rating")).toBeDefined()
    const tooHigh = validateDocument(postType, {
      title: "Ok",
      slug: { current: "ok" },
      rating: 10,
    })
    expect(tooHigh.find((i) => i.path === "rating")).toBeDefined()
  })

  test("oneOf enum", () => {
    const issues = validateDocument(postType, {
      title: "Ok",
      slug: { current: "ok" },
      status: "archiveddd",
    })
    expect(issues.find((i) => i.path === "status")).toBeDefined()
  })

  test("multiple issues are all reported", () => {
    const issues = validateDocument(postType, {
      title: "Hi",
      slug: { current: "NOT VALID" },
      rating: 99,
    })
    const paths = issues.map((i) => i.path).sort()
    expect(paths).toContain("title")
    expect(paths).toContain("slug")
    expect(paths).toContain("rating")
  })
})

describe("validateDocument — arrays and nested objects", () => {
  const withArrayType = defineType({
    name: "listy",
    title: "Listy",
    type: "document",
    fields: [
      defineField({
        name: "tags",
        title: "Tags",
        type: "array",
        of: [{ name: "tag", title: "Tag", type: "string" }],
        validation: { required: true, min: 1, max: 5 },
      }),
      defineField({
        name: "features",
        title: "Features",
        type: "array",
        of: [
          {
            name: "feature",
            title: "Feature",
            type: "object",
            typeName: "feature",
            fields: [
              defineField({
                name: "title",
                title: "Title",
                type: "string",
                validation: { required: true, max: 20 },
              }),
            ],
          },
        ],
      }),
    ],
  })

  test("required array with no items fails", () => {
    const issues = validateDocument(withArrayType, {})
    expect(issues.find((i) => i.path === "tags")).toBeDefined()
  })

  test("min/max on array length", () => {
    const tooMany = validateDocument(withArrayType, {
      tags: ["a", "b", "c", "d", "e", "f"],
    })
    expect(tooMany.find((i) => i.path === "tags")?.message).toContain("at most 5")
  })

  test("validation recurses into items when array.of is a single object type", () => {
    const issues = validateDocument(withArrayType, {
      tags: ["ok"],
      features: [
        { _type: "feature", _key: "a", title: "Fine" },
        { _type: "feature", _key: "b", title: "This one is way too long for the 20-char limit" },
      ],
    })
    // The second item's title field exceeds max:20 → nested validation error
    const nested = issues.find((i) => i.path.startsWith("features[1]"))
    expect(nested).toBeDefined()
  })
})

describe("validateDocument — blockContent (Portable Text)", () => {
  const richType = defineType({
    name: "page",
    title: "Page",
    type: "document",
    fields: [
      defineField({
        name: "body",
        title: "Body",
        type: "blockContent",
        validation: { required: true, min: 1 },
      }),
    ],
  })

  test("required blockContent with no blocks fails", () => {
    const issues = validateDocument(richType, {})
    expect(issues.find((i) => i.path === "body")?.message).toContain("required")
  })

  test("required blockContent with empty array fails", () => {
    const issues = validateDocument(richType, { body: [] })
    expect(issues.find((i) => i.path === "body")).toBeDefined()
  })

  test("blockContent with at least one block passes required", () => {
    const issues = validateDocument(richType, {
      body: [
        { _type: "block", _key: "b1", style: "normal", children: [] },
      ],
    })
    expect(issues).toEqual([])
  })
})
