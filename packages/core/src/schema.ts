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

export interface BaseField {
  name: string
  title: string
  description?: string
  readOnly?: boolean
  hidden?: boolean
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
