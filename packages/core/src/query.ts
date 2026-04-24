/**
 * A tiny GROQ-lite query engine.
 *
 * Real GROQ is a full language — we implement a small pragmatic subset that
 * covers typical CMS needs while producing the same shape of results Sanity's
 * HTTP API returns (including Content Source Maps).
 *
 * Supported:
 *   - `*[_type == "post"]`                             — filter by type
 *   - `*[_type == "post" && slug.current == $slug]`    — filter on dotted path
 *   - `*[_type == "post"][0]`                          — single-item indexing
 *   - `{title, body, "slug": slug.current}`            — projection (rename + path)
 *   - `{author->{name}}`                               — reference dereferencing
 *   - `{author->{name, "id": _id}}`                    — deref + inner projection
 *   - Nested projections on object fields             — `{seo{title}}`
 *
 * The implementation is not a full parser. It's a scan + recursive-descent
 * projection parser just expressive enough to drive the demo and visual
 * editing overlays end to end.
 */

import type { SanityDocument } from "./index"
import type { ContentSourceMap, CsmMapping } from "./csm"

export interface QueryResult<T = unknown> {
  result: T
  resultSourceMap?: ContentSourceMap
  ms?: number
}

type Scalar = string | number | boolean | null
type Value = Scalar | Value[] | { [k: string]: Value }

type FilterExpr =
  | { kind: "eq"; path: string[]; value: Scalar | { param: string } }
  | { kind: "and"; left: FilterExpr; right: FilterExpr }

/** A projection is a tree of selected fields. */
interface Projection {
  items: ProjectionItem[]
}

type ProjectionItem =
  | { kind: "field"; name: string }
  | { kind: "rename"; alias: string; path: string[] }
  | { kind: "subObject"; name: string; projection: Projection }
  | {
      kind: "deref"
      name: string
      /** Alias in the output (defaults to `name`). */
      alias?: string
      projection?: Projection
    }

interface ParsedQuery {
  typeFilter?: string
  extraFilter?: FilterExpr
  index?: number
  projection?: Projection
}

const TYPE_RE = /_type\s*==\s*"([^"]+)"/
const EQ_RE = /([a-zA-Z_][\w.]*)\s*==\s*("([^"]*)"|\$([a-zA-Z_]\w*)|(-?\d+))/
const INDEX_RE = /\[(-?\d+)\]\s*$/

export function parseQuery(query: string): ParsedQuery {
  const q = query.trim()
  const parsed: ParsedQuery = {}

  // Separate the `*[...]` filter (+ optional index) from the trailing projection.
  // We scan from the left to find the end of the filter bracket at depth 0.
  const filterStart = q.indexOf("*[")
  if (filterStart !== 0) throw new Error(`Unsupported query: ${query}`)

  let i = 2
  let depth = 1
  let inStr = false
  for (; i < q.length; i++) {
    const c = q[i]!
    if (c === '"' && q[i - 1] !== "\\") inStr = !inStr
    if (inStr) continue
    if (c === "[") depth++
    else if (c === "]") {
      depth--
      if (depth === 0) break
    }
  }
  if (depth !== 0) throw new Error(`Unbalanced brackets in: ${query}`)
  const filterInner = q.slice(2, i)
  let rest = q.slice(i + 1).trim()

  // Optional `[N]` index
  const idxMatch = rest.match(/^\[(-?\d+)\]/)
  if (idxMatch) {
    parsed.index = Number(idxMatch[1])
    rest = rest.slice(idxMatch[0].length).trim()
  }

  // Optional `{...}` projection
  if (rest.startsWith("{")) {
    const { body, end } = readBraceBody(rest, 0)
    parsed.projection = parseProjectionBody(body)
    const tail = rest.slice(end + 1).trim()
    if (tail) throw new Error(`Unexpected trailing content: ${tail}`)
  } else if (rest) {
    throw new Error(`Unexpected trailing content: ${rest}`)
  }

  // Parse the filter expression
  parseFilter(filterInner, parsed)

  return parsed
}

function parseFilter(inner: string, parsed: ParsedQuery): void {
  const t = inner.match(TYPE_RE)
  if (t) parsed.typeFilter = t[1]

  // Optional `&& field == value`
  const parts = splitTopLevel(inner, "&&").map((p) => p.trim())
  for (const p of parts) {
    if (TYPE_RE.test(p)) continue
    const m = p.match(EQ_RE)
    if (!m) continue
    const path = m[1]!.split(".")
    const value: Scalar | { param: string } = m[3] !== undefined
      ? (m[3] as string)
      : m[4] !== undefined
        ? { param: m[4]! }
        : Number(m[5])
    const expr: FilterExpr = { kind: "eq", path, value }
    parsed.extraFilter = parsed.extraFilter
      ? { kind: "and", left: parsed.extraFilter, right: expr }
      : expr
  }
}

/** Given a string starting at `{`, return the body inside and the closing `}` index. */
function readBraceBody(s: string, start: number): { body: string; end: number } {
  if (s[start] !== "{") throw new Error(`Expected '{' at ${start}`)
  let depth = 0
  let inStr = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]!
    if (c === '"' && s[i - 1] !== "\\") inStr = !inStr
    if (inStr) continue
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) return { body: s.slice(start + 1, i), end: i }
    }
  }
  throw new Error(`Unbalanced braces`)
}

function parseProjectionBody(body: string): Projection {
  const items: ProjectionItem[] = []
  const segs = splitTopLevel(body, ",")
  for (const raw of segs) {
    const s = raw.trim()
    if (!s) continue
    items.push(parseProjectionItem(s))
  }
  return { items }
}

function parseProjectionItem(s: string): ProjectionItem {
  // "alias": <something>
  const aliased = s.match(/^"([^"]+)"\s*:\s*(.+)$/s)
  if (aliased) {
    const alias = aliased[1]!
    const expr = aliased[2]!.trim()
    // "alias": author->{name} — treat as deref with alias
    const derefWithProj = expr.match(/^([a-zA-Z_]\w*)\s*->\s*\{/)
    if (derefWithProj) {
      const { body, end } = readBraceBody(expr, expr.indexOf("{"))
      if (expr.slice(end + 1).trim()) throw new Error(`Trailing content after }: ${expr}`)
      return { kind: "deref", name: derefWithProj[1]!, alias, projection: parseProjectionBody(body) }
    }
    // "alias": author->
    const derefBare = expr.match(/^([a-zA-Z_]\w*)\s*->\s*$/)
    if (derefBare) return { kind: "deref", name: derefBare[1]!, alias }
    // "alias": path.to.thing
    if (/^[a-zA-Z_][\w.]*$/.test(expr)) return { kind: "rename", alias, path: expr.split(".") }
    throw new Error(`Unsupported projection expression: ${expr}`)
  }

  // bare field: `title`
  if (/^[a-zA-Z_]\w*$/.test(s)) return { kind: "field", name: s }

  // field with deref: `author->` or `author->{...}`
  const deref = s.match(/^([a-zA-Z_]\w*)\s*->\s*(\{)?/)
  if (deref) {
    if (deref[2]) {
      const { body, end } = readBraceBody(s, s.indexOf("{"))
      if (s.slice(end + 1).trim()) throw new Error(`Trailing content after }: ${s}`)
      return { kind: "deref", name: deref[1]!, projection: parseProjectionBody(body) }
    }
    return { kind: "deref", name: deref[1]! }
  }

  // field with inline object projection: `seo{title}`
  const subObj = s.match(/^([a-zA-Z_]\w*)\s*\{/)
  if (subObj) {
    const { body, end } = readBraceBody(s, s.indexOf("{"))
    if (s.slice(end + 1).trim()) throw new Error(`Trailing content after }: ${s}`)
    return { kind: "subObject", name: subObj[1]!, projection: parseProjectionBody(body) }
  }

  throw new Error(`Unsupported projection item: ${s}`)
}

function splitTopLevel(s: string, delim: string): string[] {
  const out: string[] = []
  let depth = 0
  let inStr = false
  let buf = ""
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (c === '"' && s[i - 1] !== "\\") inStr = !inStr
    if (!inStr) {
      if (c === "{" || c === "[" || c === "(") depth++
      else if (c === "}" || c === "]" || c === ")") depth--
      else if (
        depth === 0 &&
        s.startsWith(delim, i)
      ) {
        out.push(buf)
        buf = ""
        i += delim.length - 1
        continue
      }
    }
    buf += c
  }
  if (buf.length) out.push(buf)
  return out
}

function getPath(doc: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = doc
  for (const p of path) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p]
    else return undefined
  }
  return cur
}

function matchFilter(
  doc: SanityDocument,
  expr: FilterExpr,
  params: Record<string, unknown>,
): boolean {
  if (expr.kind === "and")
    return matchFilter(doc, expr.left, params) && matchFilter(doc, expr.right, params)
  const got = getPath(doc as Record<string, unknown>, expr.path)
  const wanted =
    typeof expr.value === "object" && expr.value !== null && "param" in expr.value
      ? params[expr.value.param]
      : expr.value
  return got === wanted
}

/** CSM bookkeeping. */
class CsmBuilder {
  documents: { _id: string; _type: string }[] = []
  paths: string[] = []
  mappings: Record<string, CsmMapping> = {}
  private docIndex = new Map<string, number>()
  private pathIndex = new Map<string, number>()

  doc(id: string, type: string): number {
    const existing = this.docIndex.get(id)
    if (existing !== undefined) return existing
    const i = this.documents.length
    this.documents.push({ _id: id, _type: type })
    this.docIndex.set(id, i)
    return i
  }

  path(p: string): number {
    const existing = this.pathIndex.get(p)
    if (existing !== undefined) return existing
    const i = this.paths.length
    this.paths.push(p)
    this.pathIndex.set(p, i)
    return i
  }

  build(): ContentSourceMap {
    return { documents: this.documents, paths: this.paths, mappings: this.mappings }
  }
}

export function executeQuery(
  docs: SanityDocument[],
  query: string,
  params: Record<string, unknown> = {},
): QueryResult {
  const parsed = parseQuery(query)
  const byId = new Map<string, SanityDocument>(docs.map((d) => [d._id, d]))

  let filtered = docs
  if (parsed.typeFilter) filtered = filtered.filter((d) => d._type === parsed.typeFilter)
  if (parsed.extraFilter)
    filtered = filtered.filter((d) => matchFilter(d, parsed.extraFilter!, params))

  const csm = new CsmBuilder()

  const projectOne = (doc: SanityDocument, resultBase: string): Value => {
    if (!parsed.projection) {
      return walkAndRecord(doc, doc, [], resultBase, csm)
    }
    return applyProjection(doc, doc, [], parsed.projection, resultBase, csm, byId)
  }

  let result: Value
  if (parsed.index !== undefined) {
    const i = parsed.index < 0 ? filtered.length + parsed.index : parsed.index
    const doc = filtered[i]
    result = doc ? projectOne(doc, `$`) : null
  } else {
    result = filtered.map((d, i) => projectOne(d, `$[${i}]`))
  }

  return { result, resultSourceMap: csm.build() }
}

/** Apply a projection tree to an object (document or sub-object). */
function applyProjection(
  sourceDoc: SanityDocument,
  value: unknown,
  sourcePath: string[],
  projection: Projection,
  resultPath: string,
  csm: CsmBuilder,
  byId: Map<string, SanityDocument>,
): Value {
  const out: Record<string, Value> = {}
  const obj = (value ?? {}) as Record<string, unknown>
  for (const item of projection.items) {
    if (item.kind === "field") {
      const v = obj[item.name]
      if (v === undefined) continue
      out[item.name] = walkAndRecord(
        sourceDoc,
        v,
        [...sourcePath, item.name],
        `${resultPath}['${item.name}']`,
        csm,
      )
    } else if (item.kind === "rename") {
      const v = getPath(obj, item.path)
      if (v === undefined) continue
      out[item.alias] = walkAndRecord(
        sourceDoc,
        v,
        [...sourcePath, ...item.path],
        `${resultPath}['${item.alias}']`,
        csm,
      )
    } else if (item.kind === "subObject") {
      const v = obj[item.name]
      if (v === undefined || v === null) continue
      out[item.name] = applyProjection(
        sourceDoc,
        v,
        [...sourcePath, item.name],
        item.projection,
        `${resultPath}['${item.name}']`,
        csm,
        byId,
      )
    } else {
      // deref
      const ref = obj[item.name] as { _ref?: string } | undefined
      const alias = item.alias ?? item.name
      if (!ref || typeof ref !== "object" || !ref._ref) {
        out[alias] = null
        continue
      }
      const target = byId.get(ref._ref)
      if (!target) {
        out[alias] = null
        continue
      }
      // When dereferencing, CSM now points to the TARGET document, not the source.
      if (item.projection) {
        out[alias] = applyProjection(
          target,
          target,
          [],
          item.projection,
          `${resultPath}['${alias}']`,
          csm,
          byId,
        )
      } else {
        out[alias] = walkAndRecord(target, target, [], `${resultPath}['${alias}']`, csm)
      }
    }
  }
  return out
}

function walkAndRecord(
  doc: SanityDocument,
  value: unknown,
  sourcePath: string[],
  resultPath: string,
  csm: CsmBuilder,
): Value {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const srcPathStr = "$['" + sourcePath.join("']['") + "']"
    csm.mappings[resultPath] = {
      type: "value",
      source: { type: "documentValue", document: csm.doc(doc._id, doc._type), path: csm.path(srcPathStr) },
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((v, i) =>
      walkAndRecord(doc, v, [...sourcePath, String(i)], `${resultPath}[${i}]`, csm),
    )
  }
  if (typeof value === "object") {
    const out: Record<string, Value> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walkAndRecord(doc, v, [...sourcePath, k], `${resultPath}['${k}']`, csm)
    }
    return out
  }
  return null
}
