/**
 * Post the seed dataset to a running API. Run after `wrangler dev` starts.
 *
 *   bun run --filter=@apps/api seed
 *
 * Also mirrors the schema to the content lake as `_system.schema` so that
 * external consumer apps can introspect the schema over HTTP (the same way
 * Sanity mirrors schemas as `_system.schema` system documents).
 *
 * Uses the ADMIN_TOKEN from wrangler.json's dev vars.
 */

/// <reference types="node" />
import { seedData, schema } from "@repo/schema"
import { serializeSchema } from "@repo/core/schema"

const API = process.env.API_URL ?? "http://localhost:8787"
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token"
const DATASET = process.env.DATASET ?? "production"

// 1. Push the schema mirror. This overwrites on every seed so the db stays
//    in sync with the code-defined schema.
const schemaDoc = {
  _id: "system.schema",
  _type: "system.schema",
  ...serializeSchema(schema),
}

const schemaRes = await fetch(`${API}/v1/data/mutate/${DATASET}`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({
    mutations: [{ createOrReplace: schemaDoc }],
  }),
})
if (!schemaRes.ok) {
  console.error(`Schema mirror failed: ${schemaRes.status} ${await schemaRes.text()}`)
  process.exit(1)
}
console.log("Mirrored schema to _.schema")

// 2. Push the seed docs.
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
