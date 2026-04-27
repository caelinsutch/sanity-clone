#!/usr/bin/env bun
/**
 * CLI: read a schema file (or fetch it over HTTP from the API) and emit TS types.
 *
 * From local TS source (for use inside a monorepo with @repo/schema):
 *
 *   sanity-clone-typegen --schema packages/schema/src/index.ts \
 *                        --queries src/lib/queries.ts \
 *                        --out src/generated.ts
 *
 * From a running API (for external apps that want to codegen without
 * importing the schema source code):
 *
 *   sanity-clone-typegen --fromApi http://cms.example.com/v1/schema/production \
 *                        --queries src/lib/queries.ts \
 *                        --out src/generated.ts
 *
 * The schema file must `export` a `schema` object (Schema type) when using --schema.
 */

/// <reference types="node" />
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { emitSchemaTypes } from "./schema-emit"
import { inferQueryType, type InferOptions } from "./query-infer"
import type { Schema } from "@repo/core/schema"
import { deserializeSchema } from "@repo/core/schema"
import type { TypedQuery } from "./index"

interface Args {
  schema?: string
  fromApi?: string
  queries?: string
  out?: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--schema") out.schema = argv[++i]
    else if (a === "--fromApi") out.fromApi = argv[++i]
    else if (a === "--queries") out.queries = argv[++i]
    else if (a === "--out") out.out = argv[++i]
  }
  return out
}

async function loadSchema(args: Args): Promise<Schema> {
  if (args.fromApi) {
    const res = await fetch(args.fromApi)
    if (!res.ok) {
      throw new Error(`Failed to fetch schema from ${args.fromApi}: ${res.status} ${await res.text()}`)
    }
    const serialized = (await res.json()) as Parameters<typeof deserializeSchema>[0]
    return deserializeSchema(serialized)
  }
  if (!args.schema) {
    throw new Error("Pass either --schema <file> or --fromApi <url>")
  }
  const schemaPath = isAbsolute(args.schema) ? args.schema : resolve(process.cwd(), args.schema)
  const mod = (await import(pathToFileURL(schemaPath).href)) as { schema?: Schema }
  if (!mod.schema) throw new Error(`Schema file ${schemaPath} must export \`schema\`.`)
  return mod.schema
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if ((!args.schema && !args.fromApi) || !args.out) {
    console.error(
      "Usage: sanity-clone-typegen { --schema <file> | --fromApi <url> } [--queries <file>] --out <file>",
    )
    process.exit(1)
  }
  const outPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out)

  const schema = await loadSchema(args)

  const parts: string[] = []
  parts.push(emitSchemaTypes(schema))

  if (args.queries) {
    const queriesPath = isAbsolute(args.queries)
      ? args.queries
      : resolve(process.cwd(), args.queries)
    const queriesModule = (await import(pathToFileURL(queriesPath).href)) as Record<
      string,
      TypedQuery<unknown> | { query: string }
    >
    parts.push("")
    parts.push("// --- Query result types -------------------------------------------------")
    parts.push("")
    for (const [name, value] of Object.entries(queriesModule)) {
      if (!value || typeof value !== "object" || !("query" in value)) continue
      const typeName = `${pascal(name)}Result`
      const inferOpts: InferOptions = {}
      try {
        const t = inferQueryType(value.query, schema, inferOpts)
        parts.push(`export type ${typeName} = ${t}`)
      } catch (e) {
        parts.push(`// Could not infer ${name}: ${(e as Error).message}`)
        parts.push(`export type ${typeName} = unknown`)
      }
    }
    parts.push("")
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, parts.join("\n"))
  console.log(`Wrote ${outPath}`)
}

function pascal(s: string): string {
  return s
    .replace(/(?:^|[_-])(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase())
}

void main()
