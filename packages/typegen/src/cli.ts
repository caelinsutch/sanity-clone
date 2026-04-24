#!/usr/bin/env bun
/**
 * CLI: read a schema file and emit TS types.
 *
 *   sanity-clone-typegen --schema packages/schema/src/index.ts --out apps/demo/src/generated.ts
 *
 * The schema file must `export` a `schema` object (Schema type).
 *
 * Optional: pass `--queries <file>` to ALSO emit typed aliases for every
 * query registered with `defineQueries({...})` in that file.
 */

/// <reference types="node" />
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { emitSchemaTypes } from "./schema-emit"
import { inferQueryType, type InferOptions } from "./query-infer"
import type { Schema } from "@repo/core/schema"
import type { TypedQuery } from "./index"

interface Args {
  schema?: string
  queries?: string
  out?: string
}

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === "--schema") out.schema = argv[++i]
    else if (a === "--queries") out.queries = argv[++i]
    else if (a === "--out") out.out = argv[++i]
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.schema || !args.out) {
    console.error("Usage: sanity-clone-typegen --schema <file> [--queries <file>] --out <file>")
    process.exit(1)
  }
  const schemaPath = isAbsolute(args.schema) ? args.schema : resolve(process.cwd(), args.schema)
  const outPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out)

  const schemaModule = (await import(pathToFileURL(schemaPath).href)) as { schema: Schema }
  if (!schemaModule.schema) {
    console.error(`Schema file ${schemaPath} must export \`schema\`.`)
    process.exit(1)
  }

  const parts: string[] = []
  parts.push(emitSchemaTypes(schemaModule.schema))

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
        const t = inferQueryType(value.query, schemaModule.schema, inferOpts)
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
