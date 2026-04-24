/**
 * GROQ query → TypeScript type string.
 *
 * Takes a query AST (same shape parseQuery emits) and a schema, walks the
 * projection tree, and returns the TS type describing the result shape.
 *
 * Rules:
 *   - `*[_type == "post"]` → `Post[]`
 *   - `*[_type == "post"][0]` → `Post | null`
 *   - `*[_type == "post"]{title, body}` → `Pick<Post, "title" | "body">[]`
 *   - `*[_type == "post"]{"slug": slug.current}` → `{ slug: string }[]`
 *   - `*[_type == "post"]{author->{name}}` → `{ author: Pick<Author, "name"> | null }[]`
 *
 * Not every projection expression has a well-known type — for nested
 * references of ambiguous target, or fields the schema doesn't define,
 * we fall back to `unknown`.
 */

import { parseQuery } from "@repo/core/query"
import type {
  DocumentTypeDef,
  FieldDef,
  Schema,
} from "@repo/core/schema"

export interface InferOptions {
  /** A TypeScript expression for the `unknown` scalar. Default "unknown". */
  unknown?: string
}

export function inferQueryType(
  query: string,
  schema: Schema,
  options: InferOptions = {},
): string {
  const parsed = parseQuery(query)
  const docType = parsed.typeFilter
    ? findType(schema, parsed.typeFilter)
    : undefined

  const unknown = options.unknown ?? "unknown"
  const itemType = docType
    ? projectDocumentType(parsed.projection, docType, schema, unknown)
    : unknown

  // count(*[...]) → number
  if (parsed.kind === "count") return "number"

  // [N] → single item or null; [a..b] / [a...b] → T[] (still a list)
  if (parsed.index && parsed.index.end === undefined) return `${itemType} | null`
  return `${itemType}[]`
}

// --- internals --------------------------------------------------------------

type ParsedQuery = ReturnType<typeof parseQuery>
type Projection = NonNullable<ParsedQuery["projection"]>
type ProjectionItem = Projection["items"][number]

function findType(schema: Schema, name: string): DocumentTypeDef | undefined {
  return schema.types.find((t) => t.name === name)
}

function findFieldByPath(type: DocumentTypeDef, path: string[]): FieldDef | undefined {
  let fields = type.fields
  let current: FieldDef | undefined
  for (let i = 0; i < path.length; i++) {
    const name = path[i]!
    current = fields.find((f) => f.name === name)
    if (!current) return undefined
    if (i < path.length - 1) {
      // Slug is `{ current: string }` — treat `slug.current` as terminal.
      if (current.type === "slug" && path[i + 1] === "current" && i + 1 === path.length - 1) {
        return current
      }
      if (current.type === "object") fields = current.fields
      else return undefined
    }
  }
  return current
}

function projectDocumentType(
  projection: Projection | undefined,
  type: DocumentTypeDef,
  schema: Schema,
  unknown: string,
): string {
  if (!projection) return pascal(type.name)

  // Simple case: all items are bare fields that exist on the type (or are
  // builtins) → Pick<T, ...>.
  const allBareKnownFields = projection.items.every((i) => {
    if (i.kind !== "field") return false
    if (BUILTIN_FIELDS[i.name]) return true
    return type.fields.some((f) => f.name === i.name)
  })
  if (allBareKnownFields) {
    const keys = projection.items.map((i) => `"${(i as { name: string }).name}"`).join(" | ")
    return `Pick<${pascal(type.name)}, ${keys}>`
  }

  // Otherwise: emit a literal object type.
  const members: string[] = []
  for (const item of projection.items) {
    members.push(projectionItemToMember(item, type, schema, unknown))
  }
  return `{ ${members.join("; ")} }`
}

// Built-in document fields that every document has.
const BUILTIN_FIELDS: Record<string, string> = {
  _id: "string",
  _type: "string",
  _rev: "string",
  _createdAt: "string",
  _updatedAt: "string",
}

function projectionItemToMember(
  item: ProjectionItem,
  type: DocumentTypeDef,
  schema: Schema,
  unknown: string,
): string {
  if (item.kind === "field") {
    if (BUILTIN_FIELDS[item.name]) {
      return `${item.name}: ${BUILTIN_FIELDS[item.name]}`
    }
    const field = type.fields.find((f) => f.name === item.name)
    return `${item.name}: ${field ? fieldToTsType(field, schema, unknown) : unknown}`
  }
  if (item.kind === "rename") {
    const field = findFieldByPath(type, item.path)
    return `${item.alias}: ${field ? leafOfField(field, item.path, schema, unknown) : unknown}`
  }
  if (item.kind === "subObject") {
    const field = type.fields.find((f) => f.name === item.name)
    if (!field || field.type !== "object") return `${item.name}: ${unknown}`
    const members = item.projection.items.map((i) =>
      projectionItemToMember(i, { ...type, fields: field.fields } as DocumentTypeDef, schema, unknown),
    )
    return `${item.name}: { ${members.join("; ")} }`
  }
  // deref
  const alias = item.alias ?? item.name
  const field = type.fields.find((f) => f.name === item.name)
  if (!field || field.type !== "reference") return `${alias}: ${unknown} | null`
  const targetTypes = field.to
    .map((t) => findType(schema, t))
    .filter((t): t is DocumentTypeDef => !!t)
  if (targetTypes.length === 0) return `${alias}: ${unknown} | null`
  const projected = targetTypes.map((tt) =>
    projectDocumentType(item.projection, tt, schema, unknown),
  )
  return `${alias}: ${projected.join(" | ")} | null`
}

function fieldToTsType(field: FieldDef, schema: Schema, unknown: string): string {
  switch (field.type) {
    case "string":
    case "text":
    case "url":
      return "string"
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "slug":
      return `{ _type?: "slug"; current: string }`
    case "image":
      return `{ _type?: "image"; url?: string; asset?: { _ref: string } }`
    case "reference":
      return `{ _type: "reference"; _ref: string }`
    case "array":
      return `${field.of.map((f) => fieldToTsType(f, schema, unknown)).join(" | ")}[]`
    case "object": {
      const inner = field.fields.map((f) => `${f.name}?: ${fieldToTsType(f, schema, unknown)}`)
      return `{ ${inner.join("; ")} }`
    }
    default:
      return unknown
  }
}

function leafOfField(field: FieldDef, path: string[], schema: Schema, unknown: string): string {
  // Projection `"alias": a.b.c` — we walk through intermediate objects and
  // emit the leaf's TS type. If it's a slug and the path ends in `.current`,
  // emit `string` directly.
  if (field.type === "slug" && path[path.length - 1] === "current") return "string"
  if (field.type === "object") return unknown
  return fieldToTsType(field, schema, unknown)
}

function pascal(s: string): string {
  return s
    .replace(/(?:^|[_-])(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase())
}
