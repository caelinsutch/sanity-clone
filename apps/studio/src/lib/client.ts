"use client"

import { createClient } from "@repo/client"

// Single browser-side client instance. Mutations use the same client + token.
export const studioClient = createClient({
  apiUrl: process.env.NEXT_PUBLIC_API_URL!,
  dataset: process.env.NEXT_PUBLIC_DATASET!,
  perspective: "drafts",
  // In a real app this would come from auth; dev shortcut:
  token: "dev-admin-token",
  stega: { enabled: false, studioUrl: process.env.NEXT_PUBLIC_STUDIO_URL! },
})

export const API_URL = process.env.NEXT_PUBLIC_API_URL!
export const DATASET = process.env.NEXT_PUBLIC_DATASET!
export const STUDIO_URL = process.env.NEXT_PUBLIC_STUDIO_URL!

/**
 * Candidate preview targets shown in the preview toolbar. Useful for
 * demonstrating that the same CMS drives multiple framework frontends.
 * The first entry is the default.
 */
export interface PreviewTarget {
  id: string
  label: string
  url: string
}

export const PREVIEW_TARGETS: PreviewTarget[] = [
  { id: "next", label: "Next.js", url: process.env.NEXT_PUBLIC_DEMO_URL! },
  ...(process.env.NEXT_PUBLIC_DEMO_ASTRO_URL
    ? [{ id: "astro", label: "Astro", url: process.env.NEXT_PUBLIC_DEMO_ASTRO_URL }]
    : []),
]

// Back-compat alias for the default demo URL — some modules still import this.
export const DEMO_URL = PREVIEW_TARGETS[0]!.url
