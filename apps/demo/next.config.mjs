/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ["@repo/core", "@repo/client", "@repo/visual-editing", "@repo/comlink", "@repo/next", "@repo/schema"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787",
    NEXT_PUBLIC_DATASET: process.env.NEXT_PUBLIC_DATASET ?? "production",
    NEXT_PUBLIC_STUDIO_URL: process.env.NEXT_PUBLIC_STUDIO_URL ?? "http://localhost:3333",
  },
  async headers() {
    return [
      {
        // Allow the studio to iframe us
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' http://localhost:3333" },
        ],
      },
    ]
  },
}
export default nextConfig
