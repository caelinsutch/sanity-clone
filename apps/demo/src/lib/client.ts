/**
 * Demo site CMS integration — one call using @repo/next.
 *
 * Everything a Next.js site needs (draft-mode client, cached fetch,
 * draft/revalidate route handlers, the visual-editing bridge, and
 * `generateStaticParams` helpers) comes out of this single `defineCms()` call.
 *
 * This demo is the `next-blog` project; its own dataset is `next-blog`.
 */

import { defineCms } from "@repo/next"
import { schema } from "@repo/schema"

export const cms = defineCms({
  apiUrl: process.env.NEXT_PUBLIC_API_URL!,
  dataset: process.env.NEXT_PUBLIC_DATASET ?? "next-blog",
  projectId: "next-blog",
  studioUrl: process.env.NEXT_PUBLIC_STUDIO_URL!,
  token: process.env.CMS_READ_TOKEN ?? "dev-admin-token",
  revalidateSecret: process.env.REVALIDATE_SECRET ?? "dev-revalidate-secret",
  schema,
})

export const {
  getClient,
  buildClient,
  sanityFetch,
  DRAFT_ROUTES,
  VisualEditingBridge,
  staticParamsFor,
} = cms
