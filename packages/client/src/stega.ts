/**
 * Stega encoding — embed Content Source Map data as invisible zero-width
 * characters appended to string values.
 *
 * We use the same 4-character base-4 alphabet Sanity uses, and a 4-character
 * U+200B marker to identify encoded regions. That means encoded strings we
 * produce can be decoded by our overlay (and the format is compatible with
 * Sanity's own overlay in shape, though payloads differ).
 */

// Base-4 alphabet (2 bits per character)
const ALPHABET = ["\u200B", "\u200C", "\u200D", "\uFEFF"] as const
const CHAR_TO_VAL: Record<string, number> = {
  "\u200B": 0,
  "\u200C": 1,
  "\u200D": 2,
  "\uFEFF": 3,
}
// Marker: 4 x U+200B
const MARKER = ALPHABET[0]!.repeat(4)

export function encodePayload(payload: string): string {
  const bytes = new TextEncoder().encode(payload)
  let out = MARKER
  for (const b of bytes) {
    out +=
      ALPHABET[(b >> 6) & 0b11]! +
      ALPHABET[(b >> 4) & 0b11]! +
      ALPHABET[(b >> 2) & 0b11]! +
      ALPHABET[b & 0b11]!
  }
  return out
}

export function decodeStega(input: string): { value: string; payload: string } | null {
  const idx = input.indexOf(MARKER)
  if (idx === -1) return null
  const clean = input.slice(0, idx)
  const encoded = input.slice(idx + MARKER.length)
  // Read as many full 4-char groups as are valid
  const bytes: number[] = []
  for (let i = 0; i + 4 <= encoded.length; i += 4) {
    const a = CHAR_TO_VAL[encoded[i]!]
    const b = CHAR_TO_VAL[encoded[i + 1]!]
    const c = CHAR_TO_VAL[encoded[i + 2]!]
    const d = CHAR_TO_VAL[encoded[i + 3]!]
    if (a === undefined || b === undefined || c === undefined || d === undefined) break
    bytes.push((a << 6) | (b << 4) | (c << 2) | d)
  }
  try {
    const payload = new TextDecoder().decode(new Uint8Array(bytes))
    return { value: clean, payload }
  } catch {
    return null
  }
}

// Strip all stega encoded regions from a value / object / array (deep clean).
const STEGA_RE = new RegExp(`${MARKER}[\u200B\u200C\u200D\uFEFF]*`, "g")

export function stegaClean<T>(input: T): T {
  if (typeof input === "string") return input.replace(STEGA_RE, "") as unknown as T
  if (Array.isArray(input)) return input.map(stegaClean) as unknown as T
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = stegaClean(v)
    return out as unknown as T
  }
  return input
}

// --------------------------------------------------------------------------
// Stega encoding over a whole result tree driven by a Content Source Map
// --------------------------------------------------------------------------

import type { ContentSourceMap } from "@repo/core/csm"

export interface StegaOptions {
  studioUrl: string
  /** Return false to skip encoding a given value. */
  filter?: (props: {
    value: string
    resultPath: string
    sourcePath: string
    sourceDocument: { _id: string; _type: string }
    filterDefault: (props: {
      value: string
      resultPath: string
      sourcePath: string
      sourceDocument: { _id: string; _type: string }
    }) => boolean
  }) => boolean
}

// Field names that commonly aren't user-display text
const DENY_NAMES = new Set([
  "_type",
  "_id",
  "_ref",
  "_key",
  "_weak",
  "color",
  "email",
  "hex",
  "href",
  "icon",
  "id",
  "src",
  "type",
  "url",
  "path",
  "slug",
  "name",
  "code",
])

function defaultFilter(props: { value: string; sourcePath: string }): boolean {
  if (!props.value) return false
  // ISO-ish dates
  if (/^\d{4}-\d{2}-\d{2}/.test(props.value)) return false
  // URL-ish
  try {
    const u = new URL(props.value)
    if (["http:", "https:", "mailto:", "tel:"].includes(u.protocol)) return false
  } catch {
    /* not a url */
  }
  const segs = props.sourcePath.split("']['").map((s) => s.replace(/[\$\[\]']/g, ""))
  const last = segs[segs.length - 1] ?? ""
  if (last.startsWith("_")) return false
  if (last.toLowerCase().endsWith("id")) return false
  if (DENY_NAMES.has(last)) return false
  if (segs.includes("slug")) return false
  return true
}

function buildIntentUrl(studioUrl: string, docId: string, type: string, path: string): string {
  // Map CSM path `$['author']['name']` -> Studio path `author.name`
  const clean = path.replace(/^\$/, "").replace(/\[(\d+)\]/g, "[$1]")
  const parts: string[] = []
  const re = /\['([^']+)'\]|\[(\d+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    if (m[1] !== undefined) parts.push(m[1])
    else if (m[2] !== undefined) parts[parts.length - 1] = `${parts[parts.length - 1] ?? ""}[${m[2]}]`
  }
  const studioPath = parts.join(".")
  const id = docId.replace(/^drafts\./, "")
  return `${studioUrl.replace(/\/$/, "")}/intent/edit/mode=presentation;id=${id};type=${type};path=${encodeURIComponent(
    studioPath,
  )}`
}

/**
 * Encode a result tree using a Content Source Map, returning a new tree where
 * every string traced to a document field gets an invisible stega suffix.
 */
export function encodeResultWithCsm<T>(result: T, csm: ContentSourceMap, options: StegaOptions): T {
  const { studioUrl, filter } = options

  const walk = (value: unknown, resultPath: string): unknown => {
    if (typeof value === "string") {
      const mapping = csm.mappings[resultPath]
      if (!mapping || mapping.source.type !== "documentValue") return value
      const sourceDoc = csm.documents[mapping.source.document]
      const sourcePath = csm.paths[mapping.source.path]
      if (!sourceDoc || !sourcePath) return value
      const props = {
        value,
        resultPath,
        sourcePath,
        sourceDocument: { _id: sourceDoc._id, _type: sourceDoc._type },
      }
      const keep = filter
        ? filter({ ...props, filterDefault: defaultFilter })
        : defaultFilter(props)
      if (!keep) return value
      const href = buildIntentUrl(studioUrl, sourceDoc._id, sourceDoc._type, sourcePath)
      const payload = JSON.stringify({ origin: "sanity.io", href })
      return value + encodePayload(payload)
    }
    if (Array.isArray(value)) {
      return value.map((v, i) => walk(v, `${resultPath}[${i}]`))
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v, `${resultPath}['${k}']`)
      }
      return out
    }
    return value
  }

  // Result paths start at `$`
  return walk(result, "$") as T
}
