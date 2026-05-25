import "server-only";

// Origin split. The dashboard, login, and bearer-auth API live on the "app"
// host (dump.thebnut.com). Uploaded prototypes live on a separate "content"
// host (content.thebnut.com) so that JS inside a hosted prototype cannot
// reach session cookies or invoke Server Actions on the authenticated origin.
//
// Preview deployments and localhost don't have a `content.*` alias, so they
// fall back to single-origin behaviour — same-origin everything, no redirects.

const APP_HOSTS = new Set(["dump.thebnut.com", "url.thebnut.com"]);
export const CONTENT_HOST = "content.thebnut.com";
export const APP_HOST = "dump.thebnut.com";

/** True if this incoming host is one of the app hosts (i.e. content-paths
 *  arriving here should redirect to the content origin). False for the
 *  content host itself, preview deploys, and localhost. */
export function isAppHost(host: string | null): boolean {
  if (!host) return false;
  return APP_HOSTS.has(host);
}

/** Origin where /p/<slug>/ should live for the current request. Production:
 *  the content host. Preview/dev: the request's own origin so single-host
 *  environments still produce working URLs. */
export function contentOriginFor(host: string | null, proto = "https"): string {
  const env = process.env.NEXT_PUBLIC_CONTENT_URL?.replace(/\/+$/, "");
  if (env) return env;
  if (!host) return `https://${CONTENT_HOST}`;
  if (APP_HOSTS.has(host) || host === CONTENT_HOST) {
    return `https://${CONTENT_HOST}`;
  }
  return `${proto}://${host}`;
}

/** Build the 308 redirect target for a content-serving route handler that
 *  was hit on the app host. Returns null if the request is already on the
 *  right origin (content host, preview, or dev), so the caller can fall
 *  through to its normal logic. Respects `NEXT_PUBLIC_CONTENT_URL`. */
export function contentRedirectTarget(
  host: string | null,
  pathname: string,
  search: string,
): string | null {
  if (!isAppHost(host)) return null;
  return `${contentOriginFor(host)}${pathname}${search}`;
}
