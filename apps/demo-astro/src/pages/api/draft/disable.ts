export const prerender = false
import type { APIRoute } from "astro"
import { cms } from "../../../lib/cms"

export const GET: APIRoute = (ctx) => cms.draftRoutes.disable(ctx as any)
