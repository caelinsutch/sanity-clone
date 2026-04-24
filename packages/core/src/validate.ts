/**
 * Pure validation of a document against a schema type.
 *
 * Returns zero or more `ValidationIssue`s, each scoped to a dotted-path and
 * carrying a human-readable message. The Studio renders these inline under
 * the matching field; the API returns them on mutation rejection (422).
 *
 * No async, no dataset dependencies — this is a pure function of the doc
 * and its declared fields. Cross-document rules (e.g. "slug must be unique")
 * belong in the API-side mutation pipeline, not here.
 */

import type { DocumentTypeDef, FieldDef, FieldValidation } from "./schema"

export interface ValidationIssue {
  path: string
  message: string
  level: "error" | "warning"
}

export function validateDocument(
  type: DocumentTypeDef,
  doc: Record<string, unknown>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const field of type.fields) {
    if (field.hidden) continue
    const value = doc[field.name]
    issues.push(...validateField(field, value, field.name))
  }
  return issues
}

function validateField(field: FieldDef, value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const v = field.validation ?? {}

  // Required
  if (v.required && isEmpty(field, value)) {
    issues.push({ path, message: v.message ?? `${field.title} is required`, level: "error" })
    return issues // no point running other rules on empty required fields
  }

  // Nothing more to check if value is absent and not required
  if (value === undefined || value === null) return issues

  // min / max
  if (v.min !== undefined || v.max !== undefined) {
    const size = sizeOf(field, value)
    if (size !== null) {
      if (v.min !== undefined && size < v.min) {
        issues.push({
          path,
          level: "error",
          message: v.message ?? describeMin(field, v.min),
        })
      }
      if (v.max !== undefined && size > v.max) {
        issues.push({
          path,
          level: "error",
          message: v.message ?? describeMax(field, v.max),
        })
      }
    }
  }

  // pattern
  if (v.pattern) {
    const str = extractString(field, value)
    if (typeof str === "string") {
      try {
        if (!new RegExp(v.pattern).test(str)) {
          issues.push({
            path,
            level: "error",
            message: v.message ?? `${field.title} doesn't match ${v.pattern}`,
          })
        }
      } catch {
        /* bad regex — skip */
      }
    }
  }

  // oneOf
  if (v.oneOf && v.oneOf.length > 0) {
    if (!v.oneOf.includes(value as string | number)) {
      issues.push({
        path,
        level: "error",
        message: v.message ?? `${field.title} must be one of ${v.oneOf.join(", ")}`,
      })
    }
  }

  // Recurse into objects + arrays of objects
  if (field.type === "object" && value && typeof value === "object") {
    for (const sub of field.fields) {
      issues.push(
        ...validateField(
          sub,
          (value as Record<string, unknown>)[sub.name],
          `${path}.${sub.name}`,
        ),
      )
    }
  }
  if (field.type === "array" && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const itemValue = value[i]
      // For a single-type array we know the entry type; otherwise fall through.
      if (field.of.length === 1) {
        issues.push(...validateField(field.of[0]!, itemValue, `${path}[${i}]`))
      }
    }
  }

  return issues
}

function isEmpty(field: FieldDef, value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (field.type === "string" || field.type === "text" || field.type === "url") {
    return typeof value !== "string" || value.trim() === ""
  }
  if (field.type === "slug") {
    const c = (value as { current?: string } | undefined)?.current
    return !c || c.trim() === ""
  }
  if (field.type === "reference") {
    return !(value as { _ref?: string } | undefined)?._ref
  }
  if (field.type === "array") {
    return !Array.isArray(value) || value.length === 0
  }
  return false
}

function sizeOf(field: FieldDef, value: unknown): number | null {
  if (field.type === "number") return typeof value === "number" ? value : null
  if (field.type === "string" || field.type === "text" || field.type === "url") {
    return typeof value === "string" ? value.length : null
  }
  if (field.type === "array") return Array.isArray(value) ? value.length : null
  if (field.type === "slug") {
    const c = (value as { current?: string } | undefined)?.current
    return typeof c === "string" ? c.length : null
  }
  return null
}

function describeMin(field: FieldDef, min: number): string {
  if (field.type === "number") return `${field.title} must be at least ${min}`
  if (field.type === "array") return `${field.title} must have at least ${min} item(s)`
  return `${field.title} must be at least ${min} character(s)`
}

function describeMax(field: FieldDef, max: number): string {
  if (field.type === "number") return `${field.title} must be at most ${max}`
  if (field.type === "array") return `${field.title} must have at most ${max} item(s)`
  return `${field.title} must be at most ${max} character(s)`
}

/** Extract the string form of a value for pattern-matching. */
function extractString(field: FieldDef, value: unknown): string | null {
  if (typeof value === "string") return value
  if (field.type === "slug") {
    const c = (value as { current?: string } | undefined)?.current
    return typeof c === "string" ? c : null
  }
  return null
}
