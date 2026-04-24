/**
 * Content Source Map types. Mirrors Sanity's open standard.
 * See: https://www.sanity.io/docs/visual-editing/content-source-maps
 */

export interface CsmDocument {
  _id: string
  _type: string
  _projectId?: string
  _dataset?: string
}

export interface CsmMapping {
  type: "value"
  source:
    | { type: "documentValue"; document: number; path: number }
    | { type: "literal" }
    | { type: "unknown" }
}

export interface ContentSourceMap {
  documents: CsmDocument[]
  paths: string[]
  mappings: Record<string, CsmMapping>
}

/** Resolve the origin document + source path for a given result path. */
export function resolveMapping(
  csm: ContentSourceMap,
  resultPath: string,
): { document: CsmDocument; path: string } | null {
  const m = csm.mappings[resultPath]
  if (!m || m.source.type !== "documentValue") return null
  const document = csm.documents[m.source.document]
  const path = csm.paths[m.source.path]
  if (!document || !path) return null
  return { document, path }
}
