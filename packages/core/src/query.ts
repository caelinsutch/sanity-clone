/**
 * A small GROQ implementation.
 *
 * Implements a pragmatic subset of Sanity's GROQ query language, enough for
 * content work (filtering, ordering, slicing, projection, dereferencing).
 *
 * Grammar (roughly):
 *
 *   query       := ( count "(" source ")" ) | ( source pipeline projection? )
 *   source      := "*" ( "[" filter "]" )?
 *   pipeline    := ( "|" "order" "(" orderKeys ")" )?
 *                  ( "[" index "]" )?
 *   index       := NUM | NUM ".." NUM | NUM "..." NUM
 *   filter      := orExpr
 *   orExpr      := andExpr ( "||" andExpr )*
 *   andExpr     := cmpExpr ( "&&" cmpExpr )*
 *   cmpExpr     := value ( op value )? | "(" orExpr ")"
 *   op          := "==" | "!=" | "<" | "<=" | ">" | ">=" | "match"
 *   value       := PATH | STRING | NUM | BOOL | "null" | "$" IDENT
 *   projection  := "{" projectionItems "}"
 *   projectionItems := item ( "," item )*
 *   item        := IDENT                       // bare field
 *                | "\"" ALIAS "\"" ":" rhs     // rename
 *                | IDENT "->" projection?      // deref
 *                | IDENT projection            // inline sub-object
 *   rhs         := PATH | IDENT "->" projection?
 *
 * Not yet: subqueries in projections, array-element filters, `defined()`,
 * `coalesce()`, arithmetic, etc.
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

// --- AST -------------------------------------------------------------------

export type FilterExpr =
  | { kind: "cmp"; op: CmpOp; left: Operand; right: Operand }
  | { kind: "and"; left: FilterExpr; right: FilterExpr }
  | { kind: "or"; left: FilterExpr; right: FilterExpr }

export type CmpOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "match"

export type Operand =
  | { kind: "path"; path: string[] }
  | { kind: "literal"; value: Scalar }
  | { kind: "param"; name: string }

export interface OrderKey {
  path: string[]
  dir: "asc" | "desc"
}

export interface Projection {
  items: ProjectionItem[]
}

export type ProjectionItem =
  | { kind: "field"; name: string }
  | { kind: "rename"; alias: string; path: string[] }
  | { kind: "subObject"; name: string; projection: Projection }
  | { kind: "deref"; name: string; alias?: string; projection?: Projection }

export interface ParsedQuery {
  kind: "select" | "count"
  typeFilter?: string
  filter?: FilterExpr
  order?: OrderKey[]
  /** inclusive index — single item, null means "no index" */
  index?: { start: number; end?: number; exclusiveEnd?: boolean }
  projection?: Projection
}

// --- Tokenizer -------------------------------------------------------------

type TokKind =
  | "*"
  | "["
  | "]"
  | "{"
  | "}"
  | "("
  | ")"
  | ","
  | "."
  | ".."
  | "..."
  | "|"
  | "->"
  | ":"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"
  | "$"
  | "ident"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "eof"

interface Tok {
  kind: TokKind
  value?: string | number | boolean | null
  pos: number
}

const SINGLE_TOKENS: Record<string, TokKind> = {
  "*": "*",
  "[": "[",
  "]": "]",
  "{": "{",
  "}": "}",
  "(": "(",
  ")": ")",
  ",": ",",
  "|": "|",
  "$": "$",
  ":": ":",
}

function tokenize(input: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]!
    // whitespace
    if (/\s/.test(c)) {
      i++
      continue
    }
    // multi-char
    if (c === "." && input[i + 1] === "." && input[i + 2] === ".") {
      out.push({ kind: "...", pos: i })
      i += 3
      continue
    }
    if (c === "." && input[i + 1] === ".") {
      out.push({ kind: "..", pos: i })
      i += 2
      continue
    }
    if (c === "-" && input[i + 1] === ">") {
      out.push({ kind: "->", pos: i })
      i += 2
      continue
    }
    if (c === "=" && input[i + 1] === "=") {
      out.push({ kind: "==", pos: i })
      i += 2
      continue
    }
    if (c === "!" && input[i + 1] === "=") {
      out.push({ kind: "!=", pos: i })
      i += 2
      continue
    }
    if (c === "<" && input[i + 1] === "=") {
      out.push({ kind: "<=", pos: i })
      i += 2
      continue
    }
    if (c === ">" && input[i + 1] === "=") {
      out.push({ kind: ">=", pos: i })
      i += 2
      continue
    }
    if (c === "&" && input[i + 1] === "&") {
      out.push({ kind: "&&", pos: i })
      i += 2
      continue
    }
    if (c === "|" && input[i + 1] === "|") {
      out.push({ kind: "||", pos: i })
      i += 2
      continue
    }
    // single
    if (SINGLE_TOKENS[c]) {
      out.push({ kind: SINGLE_TOKENS[c], pos: i })
      i++
      continue
    }
    if (c === "<") {
      out.push({ kind: "<", pos: i })
      i++
      continue
    }
    if (c === ">") {
      out.push({ kind: ">", pos: i })
      i++
      continue
    }
    if (c === ".") {
      out.push({ kind: ".", pos: i })
      i++
      continue
    }
    // string literal
    if (c === '"' || c === "'") {
      const quote = c
      let j = i + 1
      let str = ""
      while (j < input.length && input[j] !== quote) {
        if (input[j] === "\\") {
          str += input[j + 1] ?? ""
          j += 2
        } else {
          str += input[j]!
          j++
        }
      }
      if (input[j] !== quote) throw new Error(`Unterminated string at ${i}`)
      out.push({ kind: "string", value: str, pos: i })
      i = j + 1
      continue
    }
    // number (including negative)
    if (/[-0-9]/.test(c) && (c !== "-" || /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i
      if (c === "-") j++
      while (j < input.length && /[0-9]/.test(input[j]!)) j++
      out.push({ kind: "number", value: Number(input.slice(i, j)), pos: i })
      i = j
      continue
    }
    // identifier / keyword
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j]!)) j++
      const word = input.slice(i, j)
      if (word === "true" || word === "false") {
        out.push({ kind: "boolean", value: word === "true", pos: i })
      } else if (word === "null") {
        out.push({ kind: "null", pos: i })
      } else {
        out.push({ kind: "ident", value: word, pos: i })
      }
      i = j
      continue
    }
    throw new Error(`Unexpected character ${JSON.stringify(c)} at ${i}`)
  }
  out.push({ kind: "eof", pos: input.length })
  return out
}

// --- Parser ----------------------------------------------------------------

class Parser {
  private pos = 0
  constructor(private tokens: Tok[]) {}

  private peek(k = 0): Tok {
    return this.tokens[this.pos + k] ?? { kind: "eof", pos: -1 }
  }
  private consume(): Tok {
    return this.tokens[this.pos++]!
  }
  private expect(kind: TokKind, value?: string): Tok {
    const t = this.peek()
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${kind}${value ? ` "${value}"` : ""}, got ${t.kind} at ${t.pos}`)
    }
    return this.consume()
  }
  private match(kind: TokKind, value?: string): boolean {
    const t = this.peek()
    if (t.kind === kind && (value === undefined || t.value === value)) {
      this.consume()
      return true
    }
    return false
  }
  private matchIdent(name: string): boolean {
    const t = this.peek()
    if (t.kind === "ident" && t.value === name) {
      this.consume()
      return true
    }
    return false
  }

  parseQuery(): ParsedQuery {
    // `count(*[...])` — a top-level function wrapping a source
    if (this.peek().kind === "ident" && this.peek().value === "count" && this.peek(1).kind === "(") {
      this.consume() // count
      this.consume() // (
      const inner = this.parseSelect()
      this.expect(")")
      this.expect("eof")
      return { ...inner, kind: "count" }
    }
    const q = this.parseSelect()
    this.expect("eof")
    return q
  }

  private parseSelect(): ParsedQuery {
    const q: ParsedQuery = { kind: "select" }
    this.expect("*")
    if (this.match("[")) {
      q.filter = this.parseFilter()
      // pull type filter to top-level for executor + CSM convenience
      q.typeFilter = extractTypeFilter(q.filter)
      this.expect("]")
    }
    // Pipeline operators: | order(...)
    while (this.peek().kind === "|" && this.peek(1).kind !== "|") {
      this.consume() // |
      if (this.matchIdent("order")) {
        this.expect("(")
        q.order = this.parseOrderKeys()
        this.expect(")")
      } else {
        const t = this.peek()
        throw new Error(`Expected order() after |, got ${t.kind}${t.value ? ` "${t.value}"` : ""}`)
      }
    }
    // Index: [n] or [a..b] or [a...b]
    if (this.peek().kind === "[") {
      this.consume()
      const start = this.expect("number").value as number
      if (this.match("..")) {
        const end = this.expect("number").value as number
        q.index = { start, end, exclusiveEnd: false }
      } else if (this.match("...")) {
        const end = this.expect("number").value as number
        q.index = { start, end, exclusiveEnd: true }
      } else {
        q.index = { start }
      }
      this.expect("]")
    }
    // Projection
    if (this.peek().kind === "{") {
      q.projection = this.parseProjection()
    }
    return q
  }

  private parseOrderKeys(): OrderKey[] {
    const keys: OrderKey[] = []
    do {
      const path = this.parsePath()
      let dir: "asc" | "desc" = "asc"
      if (this.matchIdent("asc")) dir = "asc"
      else if (this.matchIdent("desc")) dir = "desc"
      keys.push({ path, dir })
    } while (this.match(","))
    return keys
  }

  private parseFilter(): FilterExpr {
    return this.parseOr()
  }
  private parseOr(): FilterExpr {
    let left = this.parseAnd()
    while (this.match("||")) {
      const right = this.parseAnd()
      left = { kind: "or", left, right }
    }
    return left
  }
  private parseAnd(): FilterExpr {
    let left = this.parseCmp()
    while (this.match("&&")) {
      const right = this.parseCmp()
      left = { kind: "and", left, right }
    }
    return left
  }
  private parseCmp(): FilterExpr {
    if (this.match("(")) {
      const inner = this.parseOr()
      this.expect(")")
      return inner
    }
    const left = this.parseOperand()
    const t = this.peek()
    let op: CmpOp | null = null
    if (t.kind === "==") op = "=="
    else if (t.kind === "!=") op = "!="
    else if (t.kind === "<") op = "<"
    else if (t.kind === "<=") op = "<="
    else if (t.kind === ">") op = ">"
    else if (t.kind === ">=") op = ">="
    else if (t.kind === "ident" && t.value === "match") op = "match"
    if (!op) {
      // bare operand — treat as truthy check (e.g. `defined`) — we don't
      // implement those yet, but a bare path with no comparison is rare
      // in valid GROQ so we throw.
      throw new Error(`Expected comparison operator at ${t.pos}`)
    }
    this.consume()
    const right = this.parseOperand()
    return { kind: "cmp", op, left, right }
  }

  private parseOperand(): Operand {
    const t = this.peek()
    if (t.kind === "string") {
      this.consume()
      return { kind: "literal", value: t.value as string }
    }
    if (t.kind === "number") {
      this.consume()
      return { kind: "literal", value: t.value as number }
    }
    if (t.kind === "boolean") {
      this.consume()
      return { kind: "literal", value: t.value as boolean }
    }
    if (t.kind === "null") {
      this.consume()
      return { kind: "literal", value: null }
    }
    if (t.kind === "$") {
      this.consume()
      const name = this.expect("ident").value as string
      return { kind: "param", name }
    }
    if (t.kind === "ident") {
      return { kind: "path", path: this.parsePath() }
    }
    throw new Error(`Unexpected token ${t.kind} at ${t.pos}`)
  }

  private parsePath(): string[] {
    const parts: string[] = []
    parts.push(this.expect("ident").value as string)
    while (this.match(".")) {
      parts.push(this.expect("ident").value as string)
    }
    return parts
  }

  private parseProjection(): Projection {
    this.expect("{")
    const items: ProjectionItem[] = []
    if (this.peek().kind !== "}") {
      items.push(this.parseProjectionItem())
      while (this.match(",")) {
        if (this.peek().kind === "}") break
        items.push(this.parseProjectionItem())
      }
    }
    this.expect("}")
    return { items }
  }

  private parseProjectionItem(): ProjectionItem {
    const t = this.peek()
    if (t.kind === "string") {
      // "alias": <rhs>
      this.consume()
      const alias = t.value as string
      this.expect(":")
      // rhs: path, or ident-> with optional projection
      const first = this.peek()
      if (first.kind !== "ident") {
        throw new Error(`Expected identifier after "${alias}:" at ${first.pos}`)
      }
      const firstName = first.value as string
      // Look ahead for "->"
      if (this.peek(1).kind === "->") {
        this.consume() // ident
        this.consume() // ->
        if (this.peek().kind === "{") {
          return { kind: "deref", name: firstName, alias, projection: this.parseProjection() }
        }
        return { kind: "deref", name: firstName, alias }
      }
      const path = this.parsePath()
      return { kind: "rename", alias, path }
    }
    // Bare ident
    const name = this.expect("ident").value as string
    // deref?
    if (this.match("->")) {
      if (this.peek().kind === "{") {
        return { kind: "deref", name, projection: this.parseProjection() }
      }
      return { kind: "deref", name }
    }
    // inline sub-object projection?
    if (this.peek().kind === "{") {
      return { kind: "subObject", name, projection: this.parseProjection() }
    }
    return { kind: "field", name }
  }
}

function extractTypeFilter(f: FilterExpr): string | undefined {
  if (f.kind === "cmp" && f.op === "==") {
    if (
      f.left.kind === "path" &&
      f.left.path.length === 1 &&
      f.left.path[0] === "_type" &&
      f.right.kind === "literal" &&
      typeof f.right.value === "string"
    )
      return f.right.value
  }
  if (f.kind === "and") {
    return extractTypeFilter(f.left) ?? extractTypeFilter(f.right)
  }
  return undefined
}

export function parseQuery(query: string): ParsedQuery {
  return new Parser(tokenize(query)).parseQuery()
}

// --- Evaluation ------------------------------------------------------------

function resolveOperand(
  op: Operand,
  doc: Record<string, unknown>,
  params: Record<string, unknown>,
): unknown {
  if (op.kind === "literal") return op.value
  if (op.kind === "param") return params[op.name]
  return getPath(doc, op.path)
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
  if (expr.kind === "and") {
    return matchFilter(doc, expr.left, params) && matchFilter(doc, expr.right, params)
  }
  if (expr.kind === "or") {
    return matchFilter(doc, expr.left, params) || matchFilter(doc, expr.right, params)
  }
  const left = resolveOperand(expr.left, doc as unknown as Record<string, unknown>, params)
  const right = resolveOperand(expr.right, doc as unknown as Record<string, unknown>, params)
  switch (expr.op) {
    case "==":
      return left === right
    case "!=":
      return left !== right
    case "<":
      return compare(left, right) < 0
    case "<=":
      return compare(left, right) <= 0
    case ">":
      return compare(left, right) > 0
    case ">=":
      return compare(left, right) >= 0
    case "match": {
      // GROQ's `match`: wildcard match (case-insensitive, * is wildcard).
      if (typeof left !== "string" || typeof right !== "string") return false
      const pattern = new RegExp(
        "^" +
          right
            .split("*")
            .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$",
        "i",
      )
      return pattern.test(left)
    }
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0
  }
  return 0
}

function applyOrder(docs: SanityDocument[], keys: OrderKey[]): SanityDocument[] {
  return [...docs].sort((x, y) => {
    for (const k of keys) {
      const av = getPath(x as unknown as Record<string, unknown>, k.path)
      const bv = getPath(y as unknown as Record<string, unknown>, k.path)
      const cmp = compare(av, bv)
      if (cmp !== 0) return k.dir === "desc" ? -cmp : cmp
    }
    return 0
  })
}

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
  if (parsed.filter) filtered = filtered.filter((d) => matchFilter(d, parsed.filter!, params))
  if (parsed.order) filtered = applyOrder(filtered, parsed.order)

  if (parsed.kind === "count") {
    return { result: filtered.length, resultSourceMap: { documents: [], paths: [], mappings: {} } }
  }

  const csm = new CsmBuilder()

  const projectOne = (doc: SanityDocument, resultBase: string): Value => {
    if (!parsed.projection) return walkAndRecord(doc, doc, [], resultBase, csm)
    return applyProjection(doc, doc, [], parsed.projection, resultBase, csm, byId)
  }

  // Apply slicing
  let sliced = filtered
  const idx = parsed.index
  if (idx) {
    if (idx.end === undefined) {
      const n = idx.start < 0 ? filtered.length + idx.start : idx.start
      const doc = filtered[n]
      return {
        result: doc ? projectOne(doc, "$") : null,
        resultSourceMap: csm.build(),
      }
    }
    const start = idx.start < 0 ? filtered.length + idx.start : idx.start
    const endRaw = idx.end < 0 ? filtered.length + idx.end : idx.end
    const end = idx.exclusiveEnd ? endRaw : endRaw + 1
    sliced = filtered.slice(Math.max(0, start), Math.max(0, end))
  }

  const result = sliced.map((d, i) => projectOne(d, `$[${i}]`))
  return { result, resultSourceMap: csm.build() }
}

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
      source: {
        type: "documentValue",
        document: csm.doc(doc._id, doc._type),
        path: csm.path(srcPathStr),
      },
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
