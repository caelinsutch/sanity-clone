/**
 * Apply a batch of mutations atomically-ish.
 *
 * KV doesn't offer real transactions, so "atomic" here means: validate every
 * mutation against the current state, then apply them sequentially. If any
 * `ifRevisionID` check fails we abort before writing anything.
 */

import type { Mutation, MutationResult, SanityDocument } from "@repo/core"
import { bumpEvent, deleteDoc, getDoc, putDoc, type Env } from "./store.js"

function newRev(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}

function nowIso(): string {
  return new Date().toISOString()
}

function applyPatchSet(doc: SanityDocument, set: Record<string, unknown>): SanityDocument {
  const out: SanityDocument = { ...doc }
  for (const [path, value] of Object.entries(set)) {
    const parts = path.split(".")
    let cur: Record<string, unknown> = out as unknown as Record<string, unknown>
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!
      const existing = cur[p]
      if (typeof existing !== "object" || existing === null) cur[p] = {}
      cur = cur[p] as Record<string, unknown>
    }
    cur[parts[parts.length - 1]!] = value
  }
  return out
}

function applyPatchUnset(doc: SanityDocument, unset: string[]): SanityDocument {
  const out: SanityDocument = { ...doc }
  for (const path of unset) {
    const parts = path.split(".")
    let cur: Record<string, unknown> = out as unknown as Record<string, unknown>
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!
      const existing = cur[p]
      if (typeof existing !== "object" || existing === null) return out
      cur = cur[p] as Record<string, unknown>
    }
    delete cur[parts[parts.length - 1]!]
  }
  return out
}

export async function applyMutations(env: Env, dataset: string, mutations: Mutation[]): Promise<MutationResult> {
  const transactionId = newRev()
  const results: MutationResult["results"] = []
  const now = nowIso()

  // Validate ifRevisionID first
  for (const m of mutations) {
    if ("patch" in m && m.patch.ifRevisionID) {
      const cur = await getDoc(env, dataset, m.patch.id)
      if (!cur || cur._rev !== m.patch.ifRevisionID) {
        throw new Error(`Revision mismatch on ${m.patch.id}`)
      }
    }
  }

  for (const m of mutations) {
    if ("create" in m) {
      const existing = await getDoc(env, dataset, m.create._id)
      if (existing) throw new Error(`Document already exists: ${m.create._id}`)
      const doc: SanityDocument = { ...m.create, _createdAt: now, _updatedAt: now, _rev: newRev() }
      await putDoc(env, dataset, doc)
      results.push({ id: doc._id, operation: "create", document: doc })
    } else if ("createOrReplace" in m) {
      const existing = await getDoc(env, dataset, m.createOrReplace._id)
      const doc: SanityDocument = {
        ...m.createOrReplace,
        _createdAt: existing?._createdAt ?? now,
        _updatedAt: now,
        _rev: newRev(),
      }
      await putDoc(env, dataset, doc)
      results.push({
        id: doc._id,
        operation: existing ? "createOrReplace" : "create",
        document: doc,
      })
    } else if ("createIfNotExists" in m) {
      const existing = await getDoc(env, dataset, m.createIfNotExists._id)
      if (existing) {
        results.push({ id: existing._id, operation: "noop", document: existing })
        continue
      }
      const doc: SanityDocument = { ...m.createIfNotExists, _createdAt: now, _updatedAt: now, _rev: newRev() }
      await putDoc(env, dataset, doc)
      results.push({ id: doc._id, operation: "create", document: doc })
    } else if ("delete" in m) {
      const deleted = await deleteDoc(env, dataset, m.delete.id)
      results.push({ id: m.delete.id, operation: "delete", document: deleted ?? undefined })
    } else if ("patch" in m) {
      const existing = await getDoc(env, dataset, m.patch.id)
      if (!existing) throw new Error(`Document not found: ${m.patch.id}`)
      let next = existing
      if (m.patch.set) next = applyPatchSet(next, m.patch.set)
      if (m.patch.unset) next = applyPatchUnset(next, m.patch.unset)
      next = { ...next, _updatedAt: now, _rev: newRev() }
      await putDoc(env, dataset, next)
      results.push({ id: next._id, operation: "update", document: next })
    }
  }

  // Fire a single event with all affected ids for listeners
  await bumpEvent(env, dataset, {
    transactionId,
    timestamp: now,
    affected: results.map((r) => ({ id: r.id, type: r.document?._type })),
  })

  return { transactionId, results }
}
