/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ["@repo/core", "@repo/client", "@repo/comlink", "@repo/schema"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
    NEXT_PUBLIC_DATASET: process.env.NEXT_PUBLIC_DATASET ?? "production",
    NEXT_PUBLIC_STUDIO_URL: process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3333",
    NEXT_PUBLIC_DEMO_URL: process.env.NEXT_PUBLIC_DEMO_URL ?? "http://localhost:3000",
  },
}
export default nextConfig
