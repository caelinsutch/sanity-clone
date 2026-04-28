"use client"

import { useEffect, useState } from "react"
import type { SanityCloneClient } from "@repo/client"
import { API_URL } from "./client"
import { onLocalMutation } from "./local-mutations"

export interface DocListItem {
  _id: string
  _type: string
  _updatedAt: string
  title: string
}

export async function listDocuments(
  client: SanityCloneClient,
  dataset: string,
  type?: string,
): Promise<DocListItem[]> {
  const url = new URL(`/v1/data/list/${dataset}`, API_URL)
  url.searchParams.set("perspective", "drafts")
  if (type) url.searchParams.set("type", type)
  const res = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${client.config.token ?? ""}` },
  })
  const body = (await res.json()) as { documents: DocListItem[] }
  return body.documents
}

/** Subscribe to mutation events for a given dataset; returns unsubscribe. */
export function subscribeToMutations(dataset: string, handler: () => void): () => void {
  const url = new URL(`/v1/data/listen/${dataset}`, API_URL)
  const es = new EventSource(url.toString())
  es.addEventListener("mutation", handler)
  return () => es.close()
}

export function useDocuments(
  client: SanityCloneClient,
  dataset: string,
  type?: string,
): { docs: DocListItem[]; reload: () => void } {
  const [docs, setDocs] = useState<DocListItem[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    listDocuments(client, dataset, type).then((d) => {
      if (!cancelled) setDocs(d)
    })
    const bump = () => setTick((t) => t + 1)
    const unsubSse = subscribeToMutations(dataset, bump)
    const unsubLocal = onLocalMutation(bump)
    return () => {
      cancelled = true
      unsubSse()
      unsubLocal()
    }
  }, [type, tick, dataset, client])
  return { docs, reload: () => setTick((t) => t + 1) }
}
