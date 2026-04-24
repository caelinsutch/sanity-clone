/**
 * KV-backed "Content Lake" — stores documents by a composite key.
 *
 * Key layout:
 *   `doc:<dataset>:<id>`         → Document JSON
 *   `index:<dataset>:type:<type>` → JSON array of ids (maintained on writes)
 *
 * Mutations produce a transaction id and push a minimal event record onto a
 * pub/sub-like channel via Durable Object-free polling: every listener just
 * polls `events:<dataset>:latest` (monotonic counter) — see `listen.ts`.
 */

import type { SanityDocument } from "@repo/core"

export interface Env {
  CONTENT: KVNamespace
  ADMIN_TOKEN: string
  ALLOWED_ORIGINS?: string
  /** Comma-separated list of consumer site revalidation webhooks. */
  REVALIDATE_WEBHOOKS?: string
  /** Shared secret sent in `Authorization: Bearer ...` to those webhooks. */
  REVALIDATE_SECRET?: string
}

export function docKey(dataset: string, id: string): string {
  return `doc:${dataset}:${id}`
}
export function typeIndexKey(dataset: string, type: string): string {
  return `index:${dataset}:type:${type}`
}
export function eventsCounterKey(dataset: string): string {
  return `events:${dataset}:counter`
}
export function eventsKey(dataset: string, seq: number): string {
  return `events:${dataset}:${seq}`
}

export async function getDoc(env: Env, dataset: string, id: string): Promise<SanityDocument | null> {
  return (await env.CONTENT.get(docKey(dataset, id), "json")) as SanityDocument | null
}

export async function putDoc(env: Env, dataset: string, doc: SanityDocument): Promise<void> {
  await env.CONTENT.put(docKey(dataset, doc._id), JSON.stringify(doc))
  // Maintain type index (idempotent add)
  const key = typeIndexKey(dataset, doc._type)
  const ids = ((await env.CONTENT.get(key, "json")) as string[] | null) ?? []
  if (!ids.includes(doc._id)) {
    ids.push(doc._id)
    await env.CONTENT.put(key, JSON.stringify(ids))
  }
}

export async function deleteDoc(env: Env, dataset: string, id: string): Promise<SanityDocument | null> {
  const existing = await getDoc(env, dataset, id)
  if (!existing) return null
  await env.CONTENT.delete(docKey(dataset, id))
  const key = typeIndexKey(dataset, existing._type)
  const ids = ((await env.CONTENT.get(key, "json")) as string[] | null) ?? []
  const next = ids.filter((x) => x !== id)
  await env.CONTENT.put(key, JSON.stringify(next))
  return existing
}

export async function listAllDocs(env: Env, dataset: string): Promise<SanityDocument[]> {
  const all: SanityDocument[] = []
  let cursor: string | undefined
  do {
    const page = await env.CONTENT.list({ prefix: `doc:${dataset}:`, cursor })
    const values = await Promise.all(page.keys.map((k) => env.CONTENT.get(k.name, "json")))
    for (const v of values) if (v) all.push(v as SanityDocument)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return all
}

export async function bumpEvent(env: Env, dataset: string, event: unknown): Promise<number> {
  const counter = (await env.CONTENT.get(eventsCounterKey(dataset))) ?? "0"
  const next = Number(counter) + 1
  await env.CONTENT.put(eventsCounterKey(dataset), String(next))
  await env.CONTENT.put(eventsKey(dataset, next), JSON.stringify(event), { expirationTtl: 60 * 60 })
  return next
}

export async function getEventsSince(
  env: Env,
  dataset: string,
  sinceSeq: number,
): Promise<{ seq: number; event: unknown }[]> {
  const currentRaw = (await env.CONTENT.get(eventsCounterKey(dataset))) ?? "0"
  const current = Number(currentRaw)
  if (current <= sinceSeq) return []
  const out: { seq: number; event: unknown }[] = []
  for (let s = sinceSeq + 1; s <= current; s++) {
    const ev = await env.CONTENT.get(eventsKey(dataset, s), "json")
    if (ev) out.push({ seq: s, event: ev })
  }
  return out
}

export async function currentSeq(env: Env, dataset: string): Promise<number> {
  const v = (await env.CONTENT.get(eventsCounterKey(dataset))) ?? "0"
  return Number(v)
}
