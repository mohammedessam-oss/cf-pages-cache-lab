# cf-pages-cache-lab

React + Vite app for exploring Cloudflare Pages deployment and HTTP caching
headers. Two ways to manipulate caching, live in the UI:

1. **Static assets** in `public/assets/*` — cache rules set declaratively in
   [`public/_headers`](./public/_headers) (Cloudflare Pages' header syntax).
   Edit that file, redeploy, and re-fetch to see the new `Cache-Control`.
2. **Dynamic asset** at `functions/api/dynamic.ts` — a Pages Function that
   sets `Cache-Control` from a query param (`?cache=...&etag=1`), so you can
   try new header values from the UI without redeploying.

## Setup

```bash
npm install
```

## Run locally (through Wrangler, so Functions + `_headers` behave like prod)

```bash
npm run pages:dev
```

Wrangler proxies the Vite dev server and layers on Pages Functions/headers
emulation. Plain `npm run dev` also works but skips `_headers` and
`/api/dynamic`.

## Deploy

```bash
npx wrangler login   # first time only
npm run pages:deploy
```

`wrangler.toml` sets `pages_build_output_dir = "dist"`, so `pages:deploy`
builds then pushes `dist/` as a new Pages deployment.

## What to look at

Open the deployed (or `pages:dev`) URL, click "Fetch" on each card, then open
DevTools → Network and inspect the response headers per asset:

- `no-cache.json` → `no-store`: never cached anywhere.
- `short-cache.json` / `long-cache.json` → `max-age`: cached at edge + browser
  for that many seconds; watch `age` climb across refetches.
- `immutable.js` → `max-age=31536000, immutable`: cached for a year, browser
  won't even revalidate.
- `swr.json` → `stale-while-revalidate`: after `max-age` expires it still
  serves the stale copy while refetching in the background.
- `private.json` → `private`: browser may cache, Cloudflare's edge must not.
- `/api/dynamic` → pick any `Cache-Control` from the dropdown and refetch to
  see it take effect immediately, no redeploy. Watch `X-Cache: MISS` on the
  first fetch, `HIT` on the next (per unique combination of `cache`/`etag`
  params — each is its own cache key).

> **Why no `cf-cache-status`?** `*.pages.dev` is a shared domain served by
> Pages' own asset layer, not the customer-facing zone cache stack that
> stamps `cf-cache-status` (that only turns on once you attach your own
> custom domain). Without a domain, `/api/dynamic` sidesteps this by calling
> the Cache API directly and reporting `X-Cache` itself — same underlying
> edge cache, just visible without a domain. `Cache-Control`/`age`/`etag` on
> the static assets above are unaffected either way.
