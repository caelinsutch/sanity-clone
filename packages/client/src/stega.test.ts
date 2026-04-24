import { describe, expect, test } from "bun:test"
import { decodeStega, encodePayload, stegaClean, encodeResultWithCsm } from "@repo/client/stega"
import type { ContentSourceMap } from "@repo/core/csm"

describe("stega encoding primitives", () => {
  test("encodes a JSON payload as zero-width characters appended to the marker", () => {
    const out = encodePayload('{"a":1}')
    const visible = out.replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    // All output chars should be in the zero-width alphabet
    expect(visible).toBe("")
    // A 7-byte JSON = 7 payload bytes * 4 chars/byte + 4-char marker = 32 chars
    expect(out.length).toBe(4 + 7 * 4)
  })

  test("encode → decode roundtrips the payload", () => {
    const payload = '{"origin":"sanity.io","href":"http://s/intent/edit/..."}'
    const encoded = `Hello, World${encodePayload(payload)}`
    const decoded = decodeStega(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded!.value).toBe("Hello, World")
    expect(decoded!.payload).toBe(payload)
  })

  test("decodeStega returns null when no marker is present", () => {
    expect(decodeStega("just text")).toBeNull()
  })

  test("stegaClean strips encoding from strings, arrays, and objects", () => {
    const encoded = `Hi${encodePayload("{}")}`
    expect(stegaClean(encoded)).toBe("Hi")
    expect(stegaClean([encoded, "x"])).toEqual(["Hi", "x"])
    expect(stegaClean({ a: encoded, b: { c: encoded } })).toEqual({ a: "Hi", b: { c: "Hi" } })
  })

  test("stegaClean passes through non-strings", () => {
    expect(stegaClean(42)).toBe(42)
    expect(stegaClean(null)).toBe(null)
    expect(stegaClean(undefined)).toBe(undefined)
  })
})

describe("encodeResultWithCsm", () => {
  const csm: ContentSourceMap = {
    documents: [{ _id: "post-1", _type: "post" }],
    paths: ["$['title']"],
    mappings: {
      "$['title']": {
        type: "value",
        source: { type: "documentValue", document: 0, path: 0 },
      },
    },
  }

  test("appends stega to traceable string fields", () => {
    const result = { title: "Hello" }
    const out = encodeResultWithCsm(result, csm, { studioUrl: "https://s.example" })
    // Visible part unchanged
    expect(stegaClean(out.title)).toBe("Hello")
    // But there's an encoded payload
    const decoded = decodeStega(out.title)
    expect(decoded).not.toBeNull()
    const payload = JSON.parse(decoded!.payload) as { href: string }
    expect(payload.href).toContain("id=post-1")
    expect(payload.href).toContain("type=post")
    expect(payload.href).toContain("path=title")
  })

  test("leaves fields without CSM mappings untouched", () => {
    const result = { other: "no mapping" }
    const out = encodeResultWithCsm(result, csm, { studioUrl: "https://s.example" })
    expect(out.other).toBe("no mapping")
  })

  test("respects the default filter (skips URL-like values)", () => {
    const urlCsm: ContentSourceMap = {
      documents: [{ _id: "a", _type: "x" }],
      paths: ["$['href']"],
      mappings: {
        "$['href']": {
          type: "value",
          source: { type: "documentValue", document: 0, path: 0 },
        },
      },
    }
    const out = encodeResultWithCsm({ href: "https://example.com" }, urlCsm, {
      studioUrl: "https://s",
    })
    // URL-like strings are skipped
    expect(decodeStega(out.href)).toBeNull()
  })
})
