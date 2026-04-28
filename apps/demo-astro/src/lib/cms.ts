import { defineAstroCms } from "@repo/astro/server"
import { schema } from "@repo/schema"

const PUBLIC_API_URL = import.meta.env.PUBLIC_API_URL ?? "http://localhost:8787"
const PUBLIC_DATASET = import.meta.env.PUBLIC_DATASET ?? "astro-blog"
const PUBLIC_STUDIO_URL = import.meta.env.PUBLIC_STUDIO_URL ?? "http://localhost:3333"
const CMS_READ_TOKEN = import.meta.env.CMS_READ_TOKEN ?? "dev-admin-token"
const REVALIDATE_SECRET = import.meta.env.REVALIDATE_SECRET ?? "dev-revalidate-secret"

export const cms = defineAstroCms({
  apiUrl: PUBLIC_API_URL,
  dataset: PUBLIC_DATASET,
  projectId: "astro-blog",
  studioUrl: PUBLIC_STUDIO_URL,
  token: CMS_READ_TOKEN,
  revalidateSecret: REVALIDATE_SECRET,
  schema,
})
