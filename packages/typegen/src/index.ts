/**
 * @repo/typegen — turn a content schema into TypeScript types.
 *
 * Two modes:
 *
 *   1. `emitSchemaTypes(schema)` — emit interfaces for every document type,
 *      plus `AnyDocument` + `DocumentByType` helpers.
 *
 *   2. `defineQueries({...})` in app code → `emitQueryTypes(queries, schema)`
 *      at build time produces typed aliases like:
 *        export type HomeQueryResult = Post[]
 *      Consumers then write `await client.fetch(homeQuery)` and get the
 *      narrow type automatically via `defineQuery`'s phantom type parameter.
 */

export { emitSchemaTypes } from "./schema-emit"
export type { EmitOptions } from "./schema-emit"
export { inferQueryType } from "./query-infer"
export type { InferOptions } from "./query-infer"

/**
 * Author-time helper: declares a GROQ query string together with a name.
 * The return type is a phantom — tests don't actually check runtime, but
 * consumers get TS intellisense for the result shape.
 *
 *   const homeQuery = defineQuery<HomeQueryResult>("*[_type == \"post\"]{...}")
 *   await client.fetch(homeQuery) // : HomeQueryResult
 */
export interface TypedQuery<TResult> {
  readonly query: string
  // Phantom: used only at the type level. Never read at runtime.
  readonly __result?: TResult
}

export function defineQuery<TResult = unknown>(query: string): TypedQuery<TResult> {
  return { query }
}
