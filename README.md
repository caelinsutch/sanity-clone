# sanity-clone

A minimal, educational clone of [Sanity CMS](https://www.sanity.io)'s architecture —
content lake, studio, visual editing, live preview, and the whole pipeline
from schema to rendered page. Built as a Turborepo with TypeScript.

This is not a drop-in Sanity replacement. It's a from-scratch reimplementation
of the same seven-layer pattern Sanity documents
[here](https://www.sanity.io/docs/visual-editing/visual-editing-architecture),
scoped down to what fits in a weekend of reading the source.

## What it does

- **Schema-first content modeling** in TypeScript
- **GROQ-lite queries** with automatic Content Source Maps
- **Stega** (zero-width-character steganography) encodes edit intents into rendered
  strings so the frontend can click-to-edit without any explicit annotations
- **Visual editing overlays** painted over the live preview with field-level targets
- **Draft mode** with perspective switching (`published` / `drafts`)
- **SSG + ISR + on-demand revalidation** on the consumer site — new-slug drafts
  preview without 404s because of dynamic-params fallback
- **Two-way Studio ↔ preview binding** driven by schema-declared routes + locations
- **One-call integration** for new Next.js sites via `defineCms()`

## The packages

```
apps/
  api            Hono on Cloudflare Workers KV — the "Content Lake"
                 Endpoints: query, mutate, doc, listen (SSE), publish, seed
                 Fires revalidation webhooks to all consumer sites on every mutation
  studio         Next.js authoring dashboard
                 Unified 4-column layout: types · documents · editor · live preview
                 Preview iframe is bidirectionally bound to the editor
  demo           Next.js consumer blog using @repo/next for integration
                 SSG with dynamicParams for new-slug preview

packages/
  core           Types (documents, mutations, perspectives, CSM) + GROQ parser + executor + validator
  client         Sanity-style HTTP client with stega encoding + CSM + Next cache hints
  comlink        Typed postMessage protocol: Studio ↔ iframe
  visual-editing DOM overlay scanner + click-to-edit runtime
  schema         Example content schema — post, author, siteSettings, page (with slices)
                 Declares `routes` (URL → doc) and `locations` (doc → URL)
  next           Framework integration: defineCms() returns draft client,
                 sanityFetch, route handlers, VisualEditingBridge, staticParamsFor
  typegen        CLI + emitters: schema → TS interfaces, typed GROQ result
                 inference via `defineQuery<T>(query)`
```

## Quick start

Requires [Bun](https://bun.sh) and [gh](https://cli.github.com) (optional).

```sh
bun install
bun run dev
```

This starts:

- **API** — http://localhost:8787 (wrangler)
- **Studio** — http://localhost:3333 (next dev)
- **Demo** — http://localhost:3000 (next dev)

Seed the dataset once:

```sh
bun run --filter=@apps/api seed
```

Then open the Studio. You'll see a four-pane layout:

```
┌───────┬────────────┬────────────────┬──────────────────┐
│ types │ documents  │ editor form    │  live preview    │
└───────┴────────────┴────────────────┴──────────────────┘
```

Click a post → the iframe navigates to its `/posts/<slug>` page.
Click any text in the iframe → the Studio auto-opens that doc and field.

## How visual editing works (stega in 30 seconds)

When the demo renders in draft mode, every string in every query result gets a
trail of **invisible Unicode characters** appended to it. They're zero-width
(`U+200B`, `U+200C`, `U+200D`, `U+FEFF`) — four of them encode 1 byte. The
payload is a JSON object pointing back to the source document and field:

```json
{"origin":"sanity.io","href":"http://localhost:3333/intent/edit/mode=presentation;id=post-hello-world;type=post;path=title"}
```

The `<h1>` element contains `Hello, World` + ~500 invisible characters. When a
user clicks it, the overlay runtime in the browser reads the text node, decodes
the trail, and posts a message to the Studio via Comlink saying "focus the
`title` field of `post-hello-world`." The Studio reacts.

No data attributes, no component annotations. Every rendered string carries its
origin for free.

## SSG, ISR, and preview — the story end-to-end

The demo renders in **three modes**:

1. **Build time (`next build`)** — `generateStaticParams` calls the schema's
   `staticParamsFor("post")` which reads every post + computes its canonical
   URL from `locations(doc)`. Each post's HTML is rendered once.
2. **Runtime published** — cache hits (`x-nextjs-cache: HIT`). The
   `/api/revalidate` webhook invalidates tagged caches on mutations, so the
   next request re-renders.
3. **Runtime draft** — the preview cookie flips the client to
   `perspective: "drafts"` + `cache: "no-store"` + `stega: enabled`. Every
   request is fresh.

The key trick for "create a new post and preview it": `dynamicParams: true` is
Next's default, so a slug Next has never seen before falls through to an
on-demand render. In draft mode that returns the draft; in published mode it
404s until you publish.

## Schema is the single source of truth

Changing where posts live on the site is one or two edits, in one file:

```ts
// packages/schema/src/index.ts
export const post = defineType({
  name: "post",
  type: "document",
  fields: [...],
  locations: (doc) => doc.slug?.current
    ? [{ title: "Post page", href: `/posts/${doc.slug.current}` }]
    : [],
})

export const schema = defineSchema({
  types: [...],
  routes: [
    { pattern: "/posts/:slug", type: "post",
      resolve: (p) => ({ filter: '*[_type == "post" && slug.current == $slug][0]', params: { slug: p.slug } }) },
  ],
})
```

The Next folder structure still has to match the URL pattern (Next reads the
filesystem before any code runs), but `generateStaticParams`, the Studio's
two-way binding, and click-to-edit intent URLs all derive from the schema.

## Adding the CMS to a new Next site

Five lines:

```ts
// src/cms.ts
import { defineCms } from "@repo/next"
import { schema } from "@repo/schema"

export const cms = defineCms({
  apiUrl: process.env.NEXT_PUBLIC_API_URL!,
  dataset: "production",
  studioUrl: process.env.NEXT_PUBLIC_STUDIO_URL!,
  token: process.env.CMS_READ_TOKEN,
  revalidateSecret: process.env.REVALIDATE_SECRET,
  schema,
})

export const { sanityFetch, staticParamsFor, DRAFT_ROUTES, VisualEditingBridge } = cms
```

Then mount three one-line route handlers (`/api/draft/enable`, `/disable`,
`/api/revalidate`) and render `<VisualEditingBridge />` from the root layout
when draft mode is on. Done.

## Architecture — mapping to Sanity

Maps 1:1 to [Sanity's seven-layer stack](https://www.sanity.io/docs/visual-editing/visual-editing-architecture):

| Layer | Sanity | Here |
|---|---|---|
| 1. Foundation (client + stega + CSM) | `@sanity/client` | `@repo/client` |
| 2. Communication | `@sanity/comlink` | `@repo/comlink` |
| 3. Overlays | `@sanity/visual-editing` | `@repo/visual-editing` |
| 4. Data loading | `@sanity/core-loader` | `@repo/client` (listen + hooks) |
| 5. Preview auth | `@sanity/preview-url-secret` | `@repo/next` (draftMode cookie) |
| 6. Presentation tool | `sanity/presentation` | `apps/studio` |
| 7. Framework library | `next-sanity` | `@repo/next` |

## The GROQ subset

Parsed with a real tokenizer + recursive-descent parser (`packages/core/src/query.ts`).

Supported:

- `*[_type == "post"]` — filter by type
- `*[_type == "post" && (title == "A" || views > 10)]` — boolean expressions with `&&`, `||`, parens
- Operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `match` (case-insensitive wildcard with `*`)
- `| order(field asc|desc, ...)` — multi-key ordering
- `[0]` — single item (returns `T | null`)
- `[a..b]` — inclusive slice
- `[a...b]` — exclusive slice
- `count(*[...])` — counting function
- Projections: `{ field, "alias": path, nested{...}, ref->{...} }`
- Reference dereferencing with inner projections
- Parameters: `$slug`, etc.
- Content Source Maps emitted for every traceable string

Not yet: inline subqueries, array-element filters, `defined()`, `coalesce()`,
arithmetic. See the roadmap.

## Roadmap

Order roughly by leverage-to-effort ratio. Shipped items first.

**Shipped**

- [x] Schema-first content modeling with `routes` + `locations` (single source of truth)
- [x] Stega encoding + Content Source Maps for click-to-edit visual editing
- [x] Studio with unified 4-column layout (types / docs / editor / live preview)
- [x] Two-way binding: doc selection ↔ iframe URL
- [x] SSG + ISR on-demand revalidation via `/api/revalidate` webhook
- [x] Draft-mode-aware `sanityFetch` with cache tags, drafts fallback for new slugs
- [x] `defineCms()` one-call Next.js integration (`@repo/next`)
- [x] **GROQ**: `order(...)`, `[a..b]`/`[a...b]` slicing, `count()`, `||` + parens,
      `<` `<=` `>` `>=` `!=`, `match` (case-insensitive wildcard)
- [x] **Typegen** (`@repo/typegen`): schema → TS interfaces, typed queries via
      `defineQuery<T>`, CLI at `sanity-clone-typegen`
- [x] **References picker** in Studio: search combobox with type filtering
- [x] **Validation**: `required`/`min`/`max`/`pattern`/`oneOf` on field defs, shown
      inline in Studio, enforced at the API on publish (422 with issue list)
- [x] **Portable Text**: rich-text blockContent field, contenteditable Studio
      editor with style selector + Cmd+B/I mark toggles, demo renderer
- [x] **Array editor** in Studio: add/reorder/delete items with nested sub-forms
- [x] **Slices / page builder**: inline object types, `defineInlineType()`,
      discriminated `array.of` with per-type add menus
- [x] Unit + API integration test suite — 75+ tests covering stega, GROQ,
      typegen, validation, the API HTTP surface

**Next up**

- [ ] Page-builder renderer on the demo: `<PageBuilder slices={...} />` with a
      component registry and a concrete `/:slug` route showcasing hero + feature
      grid + CTA slices
- [ ] Image / asset uploads — upload endpoint, CDN transforms, Studio picker
- [ ] Document history / versions — snapshot on every write, revert + diff UI
- [ ] Real-time collaboration — CRDT-based presence + concurrent editing
- [ ] Auth — users, roles, per-dataset permissions
- [ ] Releases / scheduled publishing — stacked perspectives
- [ ] Generic outbound webhooks — anything beyond revalidation
- [ ] Studio plugins — custom inputs, desk structures, actions
- [ ] GraphQL codegen alongside GROQ
- [ ] Proper GROQ parser via peggy grammar (replace hand-rolled recursive descent
      for subqueries, arithmetic, `defined()`, `coalesce()`, etc.)
- [ ] CDN layer — make `useCdn: true` actually cache

## Why this exists

Building a CMS is a useful exercise for understanding why Sanity's architecture
exists as it does. Stega seems like a gimmick until you try to build
click-to-edit overlays without it — suddenly every component needs `data-*`
annotations and the abstraction leaks everywhere. The `locations` / `routes`
split is the only clean way to make "click a doc → navigate the preview, click
the preview → open the doc" feel like one thing. The cache-tag revalidation
dance is the only way to keep SSG and real-time editing both fast.

All these patterns are non-obvious until you've tried to do without them. This
repo is one answer to "what does the minimum viable Sanity look like?"

## License

MIT.
