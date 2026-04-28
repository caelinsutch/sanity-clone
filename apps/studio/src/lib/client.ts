"use client"

import { createClient, type SanityCloneClient } from "@repo/client"
import type { Project } from "@repo/schema/projects"

// Static process-level config that's identical across projects.
export const API_URL = process.env.NEXT_PUBLIC_API_URL!
export const STUDIO_URL = process.env.NEXT_PUBLIC_STUDIO_URL!

/**
 * Per-project browser-side client. The Studio hands this to editor components
 * once a project is selected; everything that used to read the global
 * `DATASET`/`DEMO_URL` now reads the bound project.
 */
export function clientForProject(project: Project): SanityCloneClient {
  return createClient({
    apiUrl: API_URL,
    dataset: project.dataset,
    perspective: "drafts",
    // Dev shortcut. In a real app this token would come from auth.
    token: "dev-admin-token",
    stega: { enabled: false, studioUrl: STUDIO_URL },
  })
}
