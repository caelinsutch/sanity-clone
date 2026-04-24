/**
 * All GROQ queries used by the demo site, declared with `defineQuery` so that
 * `@repo/typegen` can emit typed result aliases.
 *
 * Regenerate types with:
 *   bun run typegen
 */

import { defineQuery } from "@repo/typegen"

export const siteSettingsQuery = defineQuery(
  '*[_type == "siteSettings"][0]{title, tagline}',
)

export const postListQuery = defineQuery(
  '*[_type == "post"]{ _id, title, excerpt, "slug": slug.current }',
)

export const postBySlugQuery = defineQuery(
  '*[_type == "post" && slug.current == $slug][0]{_id, title, body, "author": author->{name}}',
)

export const postSlugsQuery = defineQuery(
  '*[_type == "post"]{"slug": slug.current}',
)
