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
export const DEMO_URL = process.env.NEXT_PUBLIC_DEMO_URL!
