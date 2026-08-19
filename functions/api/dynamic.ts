// GET /api/dynamic?cache=public,max-age=15&etag=1
// Lets you set Cache-Control (and toggle ETag) per-request from the UI.
//
// pages.dev doesn't stamp `cf-cache-status` (that's a zone-level feature,
// needs a custom domain) so we hit the Cache API directly and report our
// own X-Cache: HIT/MISS — same underlying edge cache, just visible without
// a domain.
export const onRequestGet: PagesFunction = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const cacheControl = url.searchParams.get("cache") ?? "no-store";
  const useEtag = url.searchParams.get("etag") === "1";

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(url.toString(), request);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const res = new Response(cached.body, cached);
    res.headers.set("X-Cache", "HIT");
    return res;
  }

  const body = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      cacheControlApplied: cacheControl,
    },
    null,
    2,
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": cacheControl,
    "X-Cache": "MISS",
  };

  if (useEtag) {
    headers["ETag"] = `"${body.length}-${cacheControl.length}"`;
  }

  const response = new Response(body, { headers });

  // Cache API only stores responses whose own Cache-Control says it's
  // storable (no `no-store`/`private`) — mirrors real edge behavior.
  context.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
};
