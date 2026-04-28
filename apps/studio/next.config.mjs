/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  transpilePackages: ["@repo/core", "@repo/client", "@repo/comlink", "@repo/schema"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
    NEXT_PUBLIC_STUDIO_URL: process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3333",
    // Preview URLs used by the Project registry in @repo/schema/projects.
    NEXT_PUBLIC_DEMO_URL: process.env.NEXT_PUBLIC_DEMO_URL ?? "http://localhost:3000",
    NEXT_PUBLIC_DEMO_ASTRO_URL: process.env.NEXT_PUBLIC_DEMO_ASTRO_URL ?? "http://localhost:3001",
  },
}
export default nextConfig
