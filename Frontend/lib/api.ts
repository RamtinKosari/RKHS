// API helpers for the frontend.
//
// The Next.js dev server proxies every `/api/*` request to Flask on port
// 5000 (see `next.config.ts -> rewrites()`), so the frontend can always
// use relative URLs — there's no port or host to worry about. When the
// frontend is built for production, the same proxy applies.
//
// If you ever need to call the backend from outside the proxy (rare —
// e.g. a Node.js server component, an SSR fetch), pass an explicit
// `host` and we'll switch back to absolute URLs. In the browser we just
// emit the relative path so the user-agent picks up the proxy.

const BACKEND_HOST =
  process.env.NEXT_PUBLIC_BACKEND_HOST ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `${window.location.hostname}:5000`
    : null)

/** Build an absolute-or-relative URL to a backend endpoint. */
export function apiUrl(path: string, opts: { absolute?: boolean } = {}): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  if (opts.absolute && BACKEND_HOST) {
    return `http://${BACKEND_HOST}${normalized}`
  }
  return normalized
}

/** Convenience: `fetch("/api/foo")` shortcut that mirrors the proxy. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init)
}
