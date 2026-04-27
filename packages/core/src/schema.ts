/**
 * Schema definitions — an intentionally tiny subset of Sanity's schema system.
 *
 * A schema consists of a set of "document types". Each document type has a
 * list of fields. Each field has a name, a human title, a type, and optional
 * flags. Fields are the unit at which the Studio renders inputs and at which
 * visual editing overlays are resolved.
 *
 * Types can also declare their **routes** — how documents map to URLs on the
 * consumer site. This is the equivalent of Sanity's `locations` +
 * `mainDocuments` resolvers on the Presentation Tool:
 *
 *   - `locations(doc)`  — given a document, list the URLs it appears on.
 *   - `mainDocuments(url)` — given a URL, return the owning document's id/type.
 *
 * Those two functions let the Studio auto-sync the iframe and the editor:
 * opening a doc navigates the preview; navigating the preview opens a doc.
 */

export type FieldType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "url"
  | "slug"
  | "image"
  | "reference"
  | "array"
  | "object"
  | "blockContent"

export interface BaseField {
  name: string
  title: string
  description?: string
  readOnly?: boolean
  hidden?: boolean
  /**
   * Declarative validation. Evaluated by both the Studio (for inline
   * errors + Publish gating) and the API (to reject invalid mutations).
   */
  validation?: FieldValidation
}

export interface FieldValidation {
  /** Value must be present (non-null, non-empty-string, non-empty-array). */
  required?: boolean
  /** Minimum length (string/text/array) or minimum value (number). */
  min?: number
  /** Maximum length (string/text/array) or maximum value (number). */
  max?: number
  /** Regex pattern the string must match. Serialize as string (flags supported). */
  pattern?: string
  /** For string/text: enum of allowed values. */
  oneOf?: (string | number)[]
  /** Custom message override. If absent a sensible default is used. */
  message?: string
}

export interface StringField extends BaseField {
  type: "string"
}
export interface TextField extends BaseField {
  type: "text"
  rows?: number
}
export interface NumberField extends BaseField {
  type: "number"
}
export interface BooleanField extends BaseField {
  type: "boolean"
}
export interface UrlField extends BaseField {
  type: "url"
}
export interface SlugField extends BaseField {
  type: "slug"
  source?: string
}
export interface ImageField extends BaseField {
  type: "image"
}
export interface ReferenceField extends BaseField {
  type: "reference"
  to: string[]
}
export interface ArrayField extends BaseField {
  type: "array"
  of: FieldDef[]
}
export interface ObjectField extends BaseField {
  type: "object"
  fields: FieldDef[]
  /**
   * For inline-object items inside an array: their `_type` discriminator.
   * Ignored for document-level object fields.
   */
  typeName?: string
}

export interface BlockContentField extends BaseField {
  type: "blockContent"
  /** Which block styles to allow in the editor. Defaults to h2, h3, p, blockquote. */
  styles?: BlockStyle[]
}

export type BlockStyle = "normal" | "h1" | "h2" | "h3" | "h4" | "blockquote"

/**
 * Shape of a stored block in an array field of type `blockContent`.
 *   { _type: "block", _key, style, children: [span...], markDefs: [] }
 * Spans:
 *   { _type: "span", _key, text, marks: string[] }
 */
export interface PortableTextBlock {
  _type: "block"
  _key: string
  style: BlockStyle
  children: PortableTextSpan[]
  markDefs?: PortableTextMarkDef[]
}
export interface PortableTextSpan {
  _type: "span"
  _key: string
  text: string
  marks?: string[]
}
export interface PortableTextMarkDef {
  _key: string
  _type: string
  [key: string]: unknown
}

export type FieldDef =
  | StringField
  | TextField
  | NumberField
  | BooleanField
  | UrlField
  | SlugField
  | ImageField
  | ReferenceField
  | ArrayField
  | ObjectField
  | BlockContentField

export interface DocumentLocation {
  /** Human-readable title, shown in the Studio's "Used on" list. */
  title: string
  /** Absolute site path, e.g. `/posts/hello-world`. */
  href: string
}

export interface DocumentTypeDef<Doc = Record<string, unknown>> {
  name: string
  title: string
  type: "document"
  fields: FieldDef[]
  /** Preview config — resolves a simple `{ title, subtitle, media }`. */
  preview?: {
    select: { title?: string; subtitle?: string; media?: string }
  }
  /**
   * Given a document, return the URLs where it's rendered on the site.
   * The Studio uses the first returned entry as the default preview URL
   * when an editor opens this document.
   */
  locations?: (doc: Doc) => DocumentLocation[]
}

export interface Schema {
  types: DocumentTypeDef[]
  /**
   * Route patterns that map URL paths to documents. Each route has an
   * Express-ish `pattern` ("/posts/:slug"), a document `type`, and a
   * `resolve(params)` that returns a GROQ filter like `{ slug: "hello" }`
   * used to find the matching doc.
   *
   * This is the equivalent of Sanity's `mainDocuments` resolver.
   */
  routes?: Route[]
}

export interface Route {
  pattern: string
  type: string
  /** Given the path params, return the GROQ filter that identifies the doc. */
  resolve: (params: Record<string, string>) => { filter: string; params?: Record<string, unknown> }
}

export function defineType<T extends DocumentTypeDef>(def: T): T {
  return def
}
export function defineField<T extends FieldDef>(def: T): T {
  return def
}
export function defineSchema<T extends Schema>(schema: T): T {
  return schema
}

/**
 * Declare an inline object shape for use inside `array.of: [...]`.
 * Items stored in the array carry `_type: <typeName>` + `_key` + field values.
 *
 *   const hero = defineInlineType({
 *     typeName: "hero",
 *     title: "Hero block",
 *     fields: [defineField({ name: "heading", type: "string" })],
 *   })
 *   array.of: [hero, ...]
 */
export function defineInlineType(def: {
  typeName: string
  title: string
  fields: FieldDef[]
}): ObjectField {
  return {
    name: def.typeName,
    title: def.title,
    type: "object",
    typeName: def.typeName,
    fields: def.fields,
  }
}

export function getTypeDef(schema: Schema, name: string): DocumentTypeDef | undefined {
  return schema.types.find((t) => t.name === name)
}

/**
 * Match a URL path against the schema's routes. Returns the matched route
 * + the extracted path params (e.g. `{ slug: "hello-world" }`).
 *
 * Patterns use `:name` for params and support `/` as a path separator.
 * The "*" pattern matches everything (useful as a catch-all).
 */
export function matchRoute(
  schema: Schema,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  const clean = pathname.replace(/\/$/, "") || "/"
  for (const route of schema.routes ?? []) {
    const params = matchPattern(route.pattern, clean)
    if (params) return { route, params }
  }
  return null
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === "*") return {}
  const pClean = pattern.replace(/\/$/, "") || "/"
  const patParts = pClean.split("/")
  const pathParts = pathname.split("/")
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

/**
 * Serialize the schema to plain JSON, stripping non-serializable bits
 * (the `resolve()` / `locations()` callback functions).
 *
 * The serialized form is what gets mirrored to the content lake as the
 * `_system.schema` document, and what `@repo/typegen --fromApi` fetches
 * to codegen types for external consumer apps.
 *
 * Mirrors Sanity's pattern where the primary schema lives as code in the
 * Studio, but a JSON mirror lives in the database for agents / integrations
 * / external type-gen to consume without needing the TS source.
 */
export interface SerializedSchema {
  types: SerializedType[]
  routes: SerializedRoute[]
}

export interface SerializedType {
  name: string
  title: string
  type: "document"
  fields: FieldDef[]
  /**
   * Simple preview picker. Function-based previews aren't serialized;
   * consumers fall back to the doc's title/id.
   */
  preview?: { select: { title?: string; subtitle?: string; media?: string } }
}

export interface SerializedRoute {
  pattern: string
  type: string
}

export function serializeSchema(schema: Schema): SerializedSchema {
  return {
    types: schema.types.map((t) => ({
      name: t.name,
      title: t.title,
      type: t.type,
      fields: serializeFields(t.fields),
      preview: t.preview,
    })),
    routes: (schema.routes ?? []).map((r) => ({ pattern: r.pattern, type: r.type })),
  }
}

function serializeFields(fields: FieldDef[]): FieldDef[] {
  // FieldDef is already a plain data shape — but `of` on arrays may contain
  // nested fields that we want to recurse into to ensure everything is
  // JSON-safe (no symbols, no functions leaking in).
  return fields.map((f) => {
    if (f.type === "array") {
      return { ...f, of: serializeFields(f.of) }
    }
    if (f.type === "object") {
      return { ...f, fields: serializeFields(f.fields) }
    }
    return f
  })
}

/**
 * Parse a SerializedSchema back into a Schema shape that typegen can
 * consume. Routes come back without `resolve()` so URL-resolving features
 * of the Studio won't work purely from the mirror — but type emission does.
 */
export function deserializeSchema(serialized: SerializedSchema): Schema {
  return {
    types: serialized.types as DocumentTypeDef[],
    routes: serialized.routes.map((r) => ({
      pattern: r.pattern,
      type: r.type,
      // A no-op resolve — not used during type emission.
      resolve: () => ({ filter: `*[_type == "${r.type}"][0]` }),
    })),
  }
}
