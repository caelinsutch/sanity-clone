/**
 * Post the seed dataset(s) to a running API. Run after `wrangler dev` starts.
 *
 *   bun run --filter=@apps/api seed
 *
 * By default, seeds every project declared in @repo/schema/projects into its
 * own dataset. Pass `DATASET=<name>` to seed just one. Also mirrors each
 * project's schema as a `system.schema` document so external consumer apps
 * can introspect the schema over HTTP.
 *
 * Uses the ADMIN_TOKEN env var (or the dev default if omitted).
 */

/// <reference types="node" />
import { seedData } from "@repo/schema"
import { projects } from "@repo/schema/projects"
import { serializeSchema } from "@repo/core/schema"

const API = process.env.API_URL ?? "http://localhost:8787"
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token"
const DATASET_FILTER = process.env.DATASET

const targets = DATASET_FILTER
  ? projects.filter((p) => p.dataset === DATASET_FILTER)
  : projects

if (targets.length === 0) {
  console.error(`No matching projects for DATASET=${DATASET_FILTER}`)
  process.exit(1)
}

for (const project of targets) {
  console.log(`\n── Seeding project '${project.id}' → dataset '${project.dataset}'`)

  // 1. Schema mirror
  const schemaDoc = {
    _id: "system.schema",
    _type: "system.schema",
    ...serializeSchema(project.schema),
  }
  const schemaRes = await fetch(`${API}/v1/data/mutate/${project.dataset}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ mutations: [{ createOrReplace: schemaDoc }] }),
  })
  if (!schemaRes.ok) {
    console.error(`Schema mirror failed: ${schemaRes.status} ${await schemaRes.text()}`)
    process.exit(1)
  }
  console.log(`  mirrored schema → system.schema`)

  // 2. Seed docs. The API's /seed endpoint is idempotent — existing docs are
  //    left alone so we don't clobber drafts on re-runs.
  const res = await fetch(`${API}/v1/data/seed/${project.dataset}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ documents: seedData }),
  })
  if (!res.ok) {
    console.error(`Seed failed: ${res.status} ${await res.text()}`)
    process.exit(1)
  }
  const body = (await res.json()) as { ok: boolean; count: number }
  console.log(`  seeded ${body.count} documents`)
}

console.log("\nDone.")
