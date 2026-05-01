/**
 * Project registry.
 *
 * Mirrors Sanity's project model: a project has its own id, dataset(s), and
 * schema. The Studio shows a project picker at `/` and opens `/[projectId]`
 * for a project's own workspace.
 *
 * The current demo setup has two projects that share this schema but live
 * in different KV datasets; the architecture supports per-project schemas
 * (just set `schema` to a different module).
 */

import type { Schema } from "@repo/core/schema"
import { schema as blogSchema } from "./index"

export interface Project {
  /** URL segment + storage key. Alphanumeric + dashes only. */
  id: string
  /** Human-readable name shown in the picker. */
  name: string
  /** One-line description for the picker card. */
  description?: string
  /** Which schema this project uses. */
  schema: Schema
  /** KV dataset name. Usually `production` in demos. */
  dataset: string
  /** Public preview URL for the Studio's live preview iframe. */
  demoUrl: string
  /** Display label for the preview target. */
  previewLabel: string
  /** Optional dynamic preview path prefix for static-site preview routes. */
  previewPathPrefix?: string
}

export const projects: Project[] = [
  {
    id: "next-blog",
    name: "Next.js blog",
    description:
      "The original demo — a Next.js site using @repo/next, rendered with SSG + draft mode previews.",
    schema: blogSchema,
    dataset: "next-blog",
    demoUrl:
      (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEMO_URL) ||
      "http://localhost:3000",
    previewLabel: "Next.js",
  },
  {
    id: "astro-blog",
    name: "Astro blog",
    description:
      "The same schema rendered by an Astro site using @repo/astro. Hybrid SSG + SSR on the Cloudflare adapter.",
    schema: blogSchema,
    dataset: "astro-blog",
    demoUrl:
      (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DEMO_ASTRO_URL) ||
      "http://localhost:3001",
    previewLabel: "Astro",
    previewPathPrefix: "/preview",
  },
]

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id)
}
