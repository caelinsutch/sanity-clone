/**
 * Core shared types for the sanity-clone system.
 *
 * Documents have a stable `_id`. Drafts live under the `drafts.<id>` prefix,
 * mirroring Sanity's convention. A "published" document is one whose `_id`
 * has no prefix. A "draft" document has `_id` starting with `drafts.`.
 */

export type DocumentId = string

export interface SanityDocument {
  _id: DocumentId
  _type: string
  _rev: string
  _createdAt: string
  _updatedAt: string
  [key: string]: unknown
}

export type Perspective = "published" | "drafts" | "raw"

/** Strips a `drafts.` prefix to get the published id. */
export function publishedId(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id
}

export function draftId(id: string): string {
  return id.startsWith("drafts.") ? id : `drafts.${id}`
}

export function isDraftId(id: string): boolean {
  return id.startsWith("drafts.")
}

/**
 * A mutation — a single operation applied to the dataset.
 * A subset of Sanity's mutation API, enough for our MVP.
 */
export interface CreatePayload {
  _id: DocumentId
  _type: string
  [key: string]: unknown
}

export type Mutation =
  | { create: CreatePayload }
  | { createOrReplace: CreatePayload }
  | { createIfNotExists: CreatePayload }
  | { delete: { id: DocumentId } }
  | {
      patch: {
        id: DocumentId
        /** Shallow or deep set by dotted path, e.g. { "title": "hi", "author.name": "Jane" } */
        set?: Record<string, unknown>
        /** Unset these paths. */
        unset?: string[]
        /** If provided, mutation fails if current _rev != ifRevisionID. */
        ifRevisionID?: string
      }
    }

export interface MutationResult {
  transactionId: string
  results: Array<{
    id: DocumentId
    operation: "create" | "createOrReplace" | "createIfNotExists" | "delete" | "update" | "noop"
    document?: SanityDocument
  }>
}
