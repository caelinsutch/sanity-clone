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

/** All posts, newest first. */
export const postListQuery = defineQuery(
  '*[_type == "post"] | order(_updatedAt desc){ _id, title, excerpt, "slug": slug.current }',
)

/** Just the total number of posts. */
export const postCountQuery = defineQuery('count(*[_type == "post"])')

export const postBySlugQuery = defineQuery(
  '*[_type == "post" && slug.current == $slug][0]{_id, title, body, "author": author->{name}}',
)

export const postSlugsQuery = defineQuery(
  '*[_type == "post"]{"slug": slug.current}',
)

/** A page — entire document including all slices. */
export const pageBySlugQuery = defineQuery(
  '*[_type == "page" && slug.current == $slug][0]',
)
