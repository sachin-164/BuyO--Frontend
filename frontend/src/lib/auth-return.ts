const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/verify"];

/**
 * Accept only same-origin paths for post-login redirects. This blocks
 * `//evil.example` and absolute URLs while preserving query strings and hashes.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw, "https://buyo.local");
  } catch {
    return null;
  }
  if (url.origin !== "https://buyo.local") return null;

  const path = url.pathname;
  if (AUTH_PATHS.some((authPath) => path === authPath || path.startsWith(`${authPath}/`))) {
    return null;
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function loginHref(next?: string | null): string {
  const safe = safeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

export function nextFromSearch(search: string | null | undefined): string | null {
  if (!search) return null;
  return safeNextPath(new URLSearchParams(search).get("next"));
}
