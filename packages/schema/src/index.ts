/**
 * The example content schema consumed by both the Studio and the demo site.
 *
 * Two document types:
 *   - `siteSettings`: a singleton for the site title + tagline
 *   - `post`: a blog post with title, excerpt, body, author
 */

import { defineField, defineSchema, defineType } from "@repo/core/schema"

export const siteSettings = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Site title",
      type: "string",
      validation: { required: true, min: 1, max: 60 },
    }),
    defineField({
      name: "tagline",
      title: "Tagline",
      type: "string",
      validation: { max: 100 },
    }),
    defineField({ name: "description", title: "Description", type: "text" }),
  ],
  preview: { select: { title: "title", subtitle: "tagline" } },
  locations: () => [{ title: "Home", href: "/" }],
})

export const author = defineType({
  name: "author",
  title: "Author",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      validation: { required: true, min: 2, max: 80 },
    }),
    defineField({ name: "bio", title: "Bio", type: "text", validation: { max: 500 } }),
  ],
  preview: { select: { title: "name", subtitle: "bio" } },
  locations: () => [],
})

export const post = defineType({
  name: "post",
  title: "Post",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: { required: true, min: 3, max: 80 },
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      source: "title",
      validation: {
        required: true,
        pattern: "^[a-z0-9-]+$",
        message: "Slug must contain only lowercase letters, numbers, and hyphens",
      },
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt",
      type: "text",
      rows: 2,
      validation: { max: 200 },
    }),
    defineField({
      name: "body",
      title: "Body",
      type: "text",
      rows: 10,
      validation: { required: true, min: 10 },
    }),
    defineField({
      name: "author",
      title: "Author",
      type: "reference",
      to: ["author"],
      validation: { required: true },
    }),
  ],
  preview: { select: { title: "title", subtitle: "excerpt" } },
  locations: (doc) => {
    const slug = (doc as { slug?: { current?: string } }).slug?.current
    if (!slug) return [{ title: "All posts", href: "/" }]
    return [
      { title: "Post page", href: `/posts/${slug}` },
      { title: "All posts", href: "/" },
    ]
  },
})

export const schema = defineSchema({
  types: [siteSettings, author, post],
  routes: [
    {
      pattern: "/",
      type: "siteSettings",
      resolve: () => ({ filter: '*[_type == "siteSettings"][0]' }),
    },
    {
      pattern: "/posts/:slug",
      type: "post",
      resolve: (params: Record<string, string>) => ({
        filter: '*[_type == "post" && slug.current == $slug][0]',
        params: { slug: params.slug },
      }),
    },
  ],
})

// A seed dataset used by the API on first boot.
export const seedData = [
  {
    _id: "siteSettings",
    _type: "siteSettings",
    title: "Blogstack",
    tagline: "Words, written down.",
    description: "A tiny demo blog powered by a Sanity-style CMS clone.",
  },
  {
    _id: "author-jane",
    _type: "author",
    name: "Jane Doe",
    bio: "Makes websites and writes about them.",
  },
  {
    _id: "post-hello-world",
    _type: "post",
    title: "Hello, World",
    slug: { current: "hello-world" },
    excerpt: "A short introduction to the blog.",
    body:
      "This is the very first post on the blog. It exists to demonstrate that the content pipeline works end to end.",
    author: { _type: "reference", _ref: "author-jane" },
  },
  {
    _id: "post-visual-editing",
    _type: "post",
    title: "Click to edit",
    slug: { current: "click-to-edit" },
    excerpt: "How visual editing bridges the studio and the live site.",
    body:
      "With stega encoding, every string rendered on the page carries an invisible signature pointing back to the document and field it came from. Click it, and the studio opens right at that field.",
    author: { _type: "reference", _ref: "author-jane" },
  },
]
