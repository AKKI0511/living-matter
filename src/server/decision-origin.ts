/** Next may build request.url from its bind address instead of the browser host. */
export function decisionOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    const expected = host ? new URL(`${url.protocol}//${host}`) : url;
    if (host && (expected.username || expected.password || expected.pathname !== "/" || expected.search || expected.hash))
      return false;
    return origin === expected.origin;
  } catch {
    return false;
  }
}
