// next.config.js
/**
 * Backend host the Next.js frontend proxies `/api/*` requests to.
 * Override at runtime with `BACKEND_HOST=192.168.1.10:5000 npm run dev`.
 */
const backendHost =
  process.env.BACKEND_HOST ||
  (process.env.NEXT_PUBLIC_BACKEND_HOST as string | undefined) ||
  "localhost:5000"

const nextConfig = {
  allowedDevOrigins: ["192.168.1.103", "localhost:3000"],
  // Proxy every `/api/*` request to Flask on port 5000. This means the
  // frontend can always use relative URLs — no API_BASE, no port
  // confusion, no cross-origin hassle. The rewrite keeps the `/api/`
  // prefix so backend route definitions don't change.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://${backendHost}/api/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
