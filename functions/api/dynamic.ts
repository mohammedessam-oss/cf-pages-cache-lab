// GET /api/dynamic?cache=public,max-age=15&etag=1
//
// `cf-cache-status` is normally stamped by Cloudflare's real edge cache,
// which only activates on a custom domain (zone), not *.pages.dev. This
// function fakes that header from our own Cache API simulation below so the
// lab works without buying a domain — it is NOT the platform's real value.
// If you later attach a custom domain, Cloudflare's actual edge will set its
// own authoritative `cf-cache-status` and this simulated one becomes noise —
// remove the header below at that point.
export const onRequestGet: PagesFunction = async (context) => {
  const { request } = context;
  const url = new URL(request.url);
  const cacheControl = url.searchParams.get("cache") ?? "no-store";
  const useEtag = url.searchParams.get("etag") === "1";

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(url.toString(), request);

  // Cloudflare's real edge Cache API auto-evicts entries once they pass
  // their own Cache-Control freshness lifetime (unlike the plain Cache Web
  // API, which just stores raw bytes and leaves freshness math to you). If
  // we stored the entry with the *real* max-age, it'd vanish from the cache
  // right when our own STALE/EXPIRED math needs it to still be there. So we
  // stash the real policy in this header and store the entry itself with an
  // artificially long lifetime — our own age math below is the source of
  // truth, not the platform's.
  const REAL_CC_HEADER = "X-Sim-Real-Cache-Control";

  // Helper to generate a fresh response
  const generateResponse = (status: string) => {
    const body = JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        cacheControlApplied: cacheControl,
      },
      null,
      2,
    );

    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      [REAL_CC_HEADER]: cacheControl,
      "X-Cache": status,
      "cf-cache-status": status, // simulated — see file header comment
      Date: new Date().toUTCString(), // Crucial for calculating age later!
    });

    if (useEtag) {
      headers.set("ETag", `"${body.length}-${cacheControl.length}"`);
    }

    return new Response(body, { headers });
  };

  // Clone a response for storage with a long Cache-Control so the platform
  // doesn't evict it before our manual HIT/STALE/EXPIRED math runs.
  const toStorageResponse = (response: Response) => {
    const stored = new Response(response.body, response);
    stored.headers.set("Cache-Control", "public, max-age=604800");
    return stored;
  };

  // 1. Check for BYPASS / DYNAMIC conditions
  if (cacheControl.includes("no-store")) {
    return generateResponse("BYPASS"); // rule/header explicitly says don't cache
  }
  if (useEtag && url.searchParams.get("cookie") === "1") {
    // Real Cloudflare marks a response DYNAMIC when the response shape
    // itself is disqualifying (e.g. Set-Cookie present) regardless of
    // Cache-Control — distinct from an explicit BYPASS rule match.
    const response = generateResponse("DYNAMIC");
    response.headers.set("Set-Cookie", "lab_session=1; Path=/");
    return response;
  }

  // 2. Look in the cache
  const cached = await cache.match(cacheKey);

  // 3. If nothing is in the cache, it's a MISS
  if (!cached) {
    const response = generateResponse("MISS");
    context.waitUntil(cache.put(cacheKey, toStorageResponse(response.clone())));
    return response;
  }

  // 4. We have a cached response! Let's calculate its age.
  const cachedDate = cached.headers.get("Date");
  const ageSeconds = cachedDate
    ? (Date.now() - new Date(cachedDate).getTime()) / 1000
    : 0;

  // 5. Parse the Cache-Control directives from the CACHED response — use the
  // stashed real policy, not the header we amplified for storage purposes.
  const cachedCacheControl = cached.headers.get(REAL_CC_HEADER) || "";

  // Prefer s-maxage over max-age for edge caching, default to 0
  const maxAgeMatch = cachedCacheControl.match(
    /(?:s-maxage|max-age)\s*=\s*(\d+)/,
  );
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 0;

  const swrMatch = cachedCacheControl.match(
    /stale-while-revalidate\s*=\s*(\d+)/,
  );
  const swr = swrMatch ? parseInt(swrMatch[1], 10) : 0;

  // 6. Evaluate the status based on age
  let cfCacheStatus = "";

  if (ageSeconds <= maxAge) {
    cfCacheStatus = "HIT";
  } else if (ageSeconds <= maxAge + swr) {
    cfCacheStatus = "STALE";

    // Simulate background revalidation!
    context.waitUntil(
      (async () => {
        const freshResponse = generateResponse("REVALIDATED");
        await cache.put(cacheKey, toStorageResponse(freshResponse));
      })(),
    );
  } else {
    cfCacheStatus = "EXPIRED";
  }

  // 7. Return the appropriate response
  if (cfCacheStatus === "EXPIRED") {
    // It's fully expired, wait for a synchronous fetch
    const response = generateResponse("EXPIRED");
    context.waitUntil(cache.put(cacheKey, toStorageResponse(response.clone())));
    return response;
  } else {
    // It's a HIT or STALE, serve the cached copy instantly
    const res = new Response(cached.body, cached);
    res.headers.set("Cache-Control", cachedCacheControl); // restore the real policy for the client
    res.headers.set("X-Cache", cfCacheStatus);
    res.headers.set("cf-cache-status", cfCacheStatus); // simulated
    // Optional: add an Age header to mimic CDN behavior
    res.headers.set("Age", Math.floor(ageSeconds).toString());
    return res;
  }
};
