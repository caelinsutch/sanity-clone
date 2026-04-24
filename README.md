# sanity-clone

A minimal Sanity-style headless CMS with visual editing, built end-to-end:

- **`@repo/core`** — shared types, schema definitions, and GROQ-ish query helpers
- **`@repo/client`** — Sanity-like HTTP client with stega encoding + Content Source Maps
- **`@repo/comlink`** — typed postMessage protocol between Studio and the previewed iframe
- **`@repo/visual-editing`** — DOM overlay scanner, click-to-edit, `enableVisualEditing()`
- **`apps/api`** — Hono + Cloudflare Workers KV backend (Content Lake replacement)
- **`apps/studio`** — Next.js dashboard for authoring + Presentation (iframe preview) tool
- **`apps/demo`** — Next.js demo site that consumes the API and supports visual editing

## Quick start

```sh
bun install
bun run dev
```

- API: http://localhost:8787
- Studio: http://localhost:3333
- Demo: http://localhost:3000

Open the Studio, click **Presentation**, and start editing. Click any text in
the preview to jump directly to the field.

## Architecture

Maps 1:1 to [Sanity's 7-layer visual editing stack](https://www.sanity.io/docs/visual-editing/visual-editing-architecture):

| Layer | Sanity package | Here |
| ----- | -------------- | ---- |
| 1. Foundation (client + stega + CSM) | `@sanity/client` | `@repo/client` |
| 2. Communication | `@sanity/comlink` | `@repo/comlink` |
| 3. Overlays | `@sanity/visual-editing` | `@repo/visual-editing` |
| 4. Data loading | `@sanity/core-loader` | `@repo/client` (loader subpath) |
| 5. Preview auth | `@sanity/preview-url-secret` | `@repo/client` (preview subpath) |
| 6. Presentation tool | `sanity/presentation` | `apps/studio` |
| 7. Framework library | `next-sanity` | `apps/demo` consumes `@repo/client` directly |
