/**
 * Post the seed dataset to a running API. Run after `wrangler dev` starts.
 *
 *   bun run --filter=@apps/api seed
 *
 * Uses the ADMIN_TOKEN from wrangler.json's dev vars.
 */

/// <reference types="node" />
import { seedData } from "@repo/schema"

const API = process.env.API_URL ?? "http://localhost:8787"
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token"
const DATASET = process.env.DATASET ?? "production"

const res = await fetch(`${API}/v1/data/seed/${DATASET}`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ documents: seedData }),
})
if (!res.ok) {
  console.error(`Seed failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.log(`Seeded dataset '${DATASET}':`, await res.json())
