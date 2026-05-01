import { defineConfig } from "astro/config"
import cloudflare from "@astrojs/cloudflare"

// Hybrid rendering: prerendered by default, with specific dynamic routes
// (draft mode + revalidate + preview pages) opting into SSR.
// On Cloudflare the SSR server runs as the Worker; static pages are
// served from the assets binding.
export default defineConfig({
  output: "static",
  adapter: cloudflare({
    imageService: "compile",
  }),
  server: { port: 3001, host: true },
  vite: {
    ssr: {
      noExternal: ["@repo/client", "@repo/core", "@repo/visual-editing", "@repo/astro", "@repo/schema"],
    },
  },
})
