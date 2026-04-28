export const prerender = false
import type { APIRoute } from "astro"
import { cms } from "../../lib/cms"

export const POST: APIRoute = (ctx) => cms.draftRoutes.revalidate(ctx as any)
