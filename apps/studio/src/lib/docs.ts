"use client"

import { useEffect, useState } from "react"
import { DATASET, API_URL, studioClient } from "./client"

export interface DocListItem {
  _id: string
  _type: string
  _updatedAt: string
  title: string
}

export async function listDocuments(type?: string): Promise<DocListItem[]> {
  const url = new URL(`/v1/data/list/${DATASET}`, API_URL)
  url.searchParams.set("perspective", "drafts")
  if (type) url.searchParams.set("type", type)
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${studioClient.config.token ?? ""}` },
  })
  const body = (await res.json()) as { documents: DocListItem[] }
  return body.documents
}

/** Subscribe to mutation events; returns unsubscribe. */
export function subscribeToMutations(handler: () => void): () => void {
  const url = new URL(`/v1/data/listen/${DATASET}`, API_URL)
  const es = new EventSource(url.toString())
  es.addEventListener("mutation", handler)
  return () => es.close()
}

export function useDocuments(type?: string): { docs: DocListItem[]; reload: () => void } {
  const [docs, setDocs] = useState<DocListItem[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    listDocuments(type).then((d) => {
      if (!cancelled) setDocs(d)
    })
    const unsub = subscribeToMutations(() => setTick((t) => t + 1))
    return () => {
      cancelled = true
      unsub()
    }
  }, [type, tick])
  return { docs, reload: () => setTick((t) => t + 1) }
}
