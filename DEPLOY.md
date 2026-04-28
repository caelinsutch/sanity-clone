# Deploying to Cloudflare

All apps run on Cloudflare Workers:

- **API** — a plain Worker with a KV namespace for the content lake.
- **Next demo** and **Studio** — Next.js apps via [OpenNext](https://opennext.js.org/cloudflare).
- **Astro demo** — Astro with the `@astrojs/cloudflare` adapter.

All three consumer apps call the API through a **service binding** (`env.API`)
because same-subdomain `*.workers.dev` → `*.workers.dev` subrequests are
rejected with error 1042. Browsers still hit the public URL directly.

## One-time setup

```bash
# 1. Authenticate
bunx wrangler login

# 2. Find your account id
bunx wrangler whoami
```

Edit `apps/api/wrangler.json`, `apps/demo/wrangler.jsonc`, and
`apps/studio/wrangler.jsonc` — replace the `account_id` with yours.

```bash
# 3. Create KV namespaces (remember the ids)
bunx wrangler kv namespace create sanity-clone-content       # API content lake
bunx wrangler kv namespace create sanity-clone-demo-cache    # Demo SSG cache
bunx wrangler kv namespace create sanity-clone-studio-cache  # Studio SSG cache
bunx wrangler kv namespace create sanity-clone-astro-session # Astro sessions (optional)
```

Paste the ids into the four wrangler configs.

## Deploy the API

```bash
cd apps/api

# Upload secrets (replace values)
echo "$(openssl rand -hex 24)" | bunx wrangler secret put ADMIN_TOKEN --env production
echo "$(openssl rand -hex 24)" | bunx wrangler secret put REVALIDATE_SECRET --env production

# Deploy
bunx wrangler deploy --env production
```

The deploy prints the URL (e.g. `https://sanity-clone-api.<sub>.workers.dev`).

Seed the dataset:

```bash
ADMIN_TOKEN=<the admin token you set above> \
API_URL=https://sanity-clone-api.<sub>.workers.dev \
bun run --filter=@apps/api seed
```

## Deploy the Next demo, Studio, and Astro demo

Next.js apps need the prod URLs baked in at build time:

```bash
export NEXT_PUBLIC_API_URL=https://sanity-clone-api.<sub>.workers.dev
export NEXT_PUBLIC_DATASET=production
export NEXT_PUBLIC_STUDIO_URL=https://sanity-clone-studio.<sub>.workers.dev
export NEXT_PUBLIC_DEMO_URL=https://sanity-clone-demo.<sub>.workers.dev
export NEXT_PUBLIC_DEMO_ASTRO_URL=https://sanity-clone-astro-demo.<sub>.workers.dev

# Next.js demo
bun run --filter=@apps/demo cf:build
echo $ADMIN_TOKEN | bunx wrangler secret put CMS_READ_TOKEN --cwd apps/demo
echo $REVALIDATE_SECRET | bunx wrangler secret put REVALIDATE_SECRET --cwd apps/demo
bun run --filter=@apps/demo cf:deploy

# Studio
bun run --filter=@apps/studio cf:build
bun run --filter=@apps/studio cf:deploy
```

The Astro demo uses `PUBLIC_*` env vars (Astro convention):

```bash
export PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
export PUBLIC_DATASET=production
export PUBLIC_STUDIO_URL=$NEXT_PUBLIC_STUDIO_URL

bun run --filter=@apps/demo-astro build
echo $ADMIN_TOKEN | bunx wrangler secret put CMS_READ_TOKEN --cwd apps/demo-astro
echo $REVALIDATE_SECRET | bunx wrangler secret put REVALIDATE_SECRET --cwd apps/demo-astro
bun run --filter=@apps/demo-astro cf:deploy
```

That's it — visit the Studio URL, click **Page → Home**, flip the preview
toolbar to `split`, and you'll see the same dataset rendered through both
Next.js and Astro side-by-side.

## How revalidation works in production

- Publishing a doc in the Studio mutates the API (`drafts.x` → `x`).
- The API's mutation handler fires a webhook at
  `/api/revalidate` on the demo, signed with `REVALIDATE_SECRET`.
- The demo calls `revalidateTag()` for per-doc + per-type tags, which
  invalidates the OpenNext KV cache for the matching SSG routes.

For draft mode previews inside the Studio iframe, `@repo/next`'s
`VisualEditingBridge` subscribes to the API's SSE mutation stream and
hard-reloads the iframe on each mutation. This bypasses Next.js's
client-side RSC cache, which isn't reliably invalidated by
`router.refresh()` on SSG routes.
