/**
 * @repo/next — one-liner Next.js integration.
 *
 * Usage (in any Next.js app):
 *
 *   // src/cms.ts
 *   import { defineCms } from "@repo/next"
 *
 *   export const { getClient, sanityFetch, DRAFT_ROUTES, VisualEditingBridge } = defineCms({
 *     apiUrl: process.env.NEXT_PUBLIC_API_URL!,
 *     dataset: "production",
 *     studioUrl: process.env.NEXT_PUBLIC_STUDIO_URL!,
 *     token: process.env.CMS_READ_TOKEN,            // server-only
 *     revalidateSecret: process.env.REVALIDATE_SECRET,
 *   })
 *
 * This single call gives the site:
 *   - `getClient()` — returns a client aware of draft mode + stega.
 *   - `sanityFetch(query, params, opts)` — cached fetch with `next.tags`.
 *   - `DRAFT_ROUTES.enable / disable / revalidate` — route handlers to mount
 *     at `/api/draft/enable`, `/api/draft/disable`, `/api/revalidate`.
 *   - `<VisualEditingBridge />` — client component for the root layout.
 */

export { defineCms } from "./server"
export type { CmsConfig, ConfiguredCms } from "./server"
