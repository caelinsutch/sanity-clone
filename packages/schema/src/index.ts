/**
 * The example content schema consumed by both the Studio and the demo site.
 *
 * Two document types:
 *   - `siteSettings`: a singleton for the site title + tagline
 *   - `post`: a blog post with title, excerpt, body, author
 */

import { defineField, defineInlineType, defineSchema, defineType } from "@repo/core/schema"

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
      type: "blockContent",
      validation: { required: true, min: 1 },
      styles: ["normal", "h2", "h3", "blockquote"],
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

// --- Inline slice types used by the `page` document type below --------------

/** Hero slice: a big heading + subheading + optional CTA label. */
export const heroSlice = defineInlineType({
  typeName: "heroSlice",
  title: "Hero",
  fields: [
    defineField({
      name: "heading",
      title: "Heading",
      type: "string",
      validation: { required: true, min: 1, max: 120 },
    }),
    defineField({
      name: "subheading",
      title: "Subheading",
      type: "text",
      rows: 2,
      validation: { max: 200 },
    }),
    defineField({ name: "ctaLabel", title: "CTA label", type: "string" }),
    defineField({ name: "ctaHref", title: "CTA URL", type: "url" }),
  ],
})

/** Feature grid: a title + N feature cards. */
export const featureGridSlice = defineInlineType({
  typeName: "featureGridSlice",
  title: "Feature grid",
  fields: [
    defineField({
      name: "heading",
      title: "Section heading",
      type: "string",
      validation: { max: 80 },
    }),
    defineField({
      name: "features",
      title: "Features",
      type: "array",
      of: [
        {
          name: "feature",
          type: "object",
          typeName: "feature",
          title: "Feature",
          fields: [
            defineField({
              name: "title",
              title: "Title",
              type: "string",
              validation: { required: true, max: 60 },
            }),
            defineField({
              name: "description",
              title: "Description",
              type: "text",
              rows: 2,
              validation: { max: 200 },
            }),
          ],
        },
      ],
      validation: { min: 1 },
    }),
  ],
})

/** Call to action: short prompt + big button. */
export const ctaSlice = defineInlineType({
  typeName: "ctaSlice",
  title: "Call to action",
  fields: [
    defineField({
      name: "heading",
      title: "Heading",
      type: "string",
      validation: { required: true, max: 80 },
    }),
    defineField({ name: "buttonLabel", title: "Button label", type: "string" }),
    defineField({ name: "buttonHref", title: "Button URL", type: "url" }),
  ],
})

/** Free-form rich text slice. */
export const richTextSlice = defineInlineType({
  typeName: "richTextSlice",
  title: "Rich text",
  fields: [
    defineField({
      name: "body",
      title: "Body",
      type: "blockContent",
      validation: { required: true, min: 1 },
    }),
  ],
})

/** Page document: a composable content type built from ordered slices. */
export const page = defineType({
  name: "page",
  title: "Page",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: { required: true, min: 1, max: 120 },
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      source: "title",
      validation: {
        required: true,
        pattern: "^[a-z0-9-]+$",
      },
    }),
    defineField({
      name: "slices",
      title: "Slices",
      type: "array",
      of: [heroSlice, featureGridSlice, richTextSlice, ctaSlice],
      validation: { min: 1 },
    }),
  ],
  preview: { select: { title: "title" } },
  locations: (doc) => {
    const slug = (doc as { slug?: { current?: string } }).slug?.current
    return slug ? [{ title: "Page", href: `/${slug}` }] : []
  },
})

export const schema = defineSchema({
  types: [siteSettings, author, post, page],
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
    {
      pattern: "/:slug",
      type: "page",
      resolve: (params: Record<string, string>) => ({
        filter: '*[_type == "page" && slug.current == $slug][0]',
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
    body: [
      {
        _type: "block",
        _key: "b1",
        style: "h2",
        children: [{ _type: "span", _key: "s1", text: "A fresh start", marks: [] }],
      },
      {
        _type: "block",
        _key: "b2",
        style: "normal",
        children: [
          {
            _type: "span",
            _key: "s2",
            text: "This is the very first post on the blog. It exists to demonstrate that the content pipeline works end to end — ",
            marks: [],
          },
          {
            _type: "span",
            _key: "s3",
            text: "from schema to render",
            marks: ["strong"],
          },
          { _type: "span", _key: "s4", text: ".", marks: [] },
        ],
      },
      {
        _type: "block",
        _key: "b3",
        style: "blockquote",
        children: [
          { _type: "span", _key: "s5", text: "Content-as-data is a good idea.", marks: [] },
        ],
      },
    ],
    author: { _type: "reference", _ref: "author-jane" },
  },
  {
    _id: "post-visual-editing",
    _type: "post",
    title: "Click to edit",
    slug: { current: "click-to-edit" },
    excerpt: "How visual editing bridges the studio and the live site.",
    body: [
      {
        _type: "block",
        _key: "b1",
        style: "normal",
        children: [
          {
            _type: "span",
            _key: "s1",
            text: "With stega encoding, every string rendered on the page carries an invisible signature pointing back to the document and field it came from. Click it, and the studio opens right at that field.",
            marks: [],
          },
        ],
      },
    ],
    author: { _type: "reference", _ref: "author-jane" },
  },
  {
    _id: "page-home",
    _type: "page",
    title: "Home",
    slug: { current: "home" },
    slices: [
      {
        _type: "heroSlice",
        _key: "hero1",
        heading: "Composable content, editable inline.",
        subheading:
          "Build marketing pages out of reusable slices. Editors see their changes in the live preview as they type.",
        ctaLabel: "Read the blog",
        ctaHref: "/posts/hello-world",
      },
      {
        _type: "featureGridSlice",
        _key: "fg1",
        heading: "Why slices",
        features: [
          {
            _type: "feature",
            _key: "f1",
            title: "Reorder instantly",
            description: "Drag slices around in the Studio and see the page change live.",
          },
          {
            _type: "feature",
            _key: "f2",
            title: "Per-slice components",
            description: "Every slice is a React component on the consumer side.",
          },
          {
            _type: "feature",
            _key: "f3",
            title: "Typed ends to end",
            description: "Generated TypeScript types flow from schema to rendered output.",
          },
        ],
      },
      {
        _type: "ctaSlice",
        _key: "cta1",
        heading: "Ready to try it?",
        buttonLabel: "Visit the studio",
        buttonHref: "http://localhost:3333/",
      },
    ],
  },
]
