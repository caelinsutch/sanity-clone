/** @type {import('next').NextConfig} */
const STUDIO_URL = process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3333"

const nextConfig = {
  reactStrictMode: false,
  // Avoid "multiple lockfiles" warning in the monorepo.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  transpilePackages: ["@repo/core", "@repo/client", "@repo/visual-editing", "@repo/comlink", "@repo/next", "@repo/schema"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
    NEXT_PUBLIC_DATASET: process.env.NEXT_PUBLIC_DATASET ?? "next-blog",
    NEXT_PUBLIC_STUDIO_URL: STUDIO_URL,
  },
  async headers() {
    return [
      {
        // Allow the studio to iframe us
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${STUDIO_URL}` },
        ],
      },
    ]
  },
}
export default nextConfig
