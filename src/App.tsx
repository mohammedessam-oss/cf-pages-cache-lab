import { useEffect, useState } from 'react'
import './App.css'

const STATIC_ASSETS = [
  { path: '/assets/no-cache.json', rule: 'no-store' },
  { path: '/assets/short-cache.json', rule: 'public, max-age=10' },
  { path: '/assets/long-cache.json', rule: 'public, max-age=3600' },
  { path: '/assets/immutable.js', rule: 'public, max-age=31536000, immutable' },
  { path: '/assets/swr.json', rule: 'public, max-age=5, stale-while-revalidate=30' },
  { path: '/assets/private.json', rule: 'private, max-age=60' },
]

const CACHE_PRESETS = [
  'no-store',
  'public, max-age=10',
  'public, max-age=3600',
  'private, max-age=30',
  'public, max-age=15, stale-while-revalidate=60',
  'public, max-age=0, s-maxage=60',
  'public, max-age=10, s-maxage=300',
  'public, max-age=3600, s-maxage=10',
  'public, s-maxage=60, must-revalidate',
]

type FetchResult = {
  path: string
  status: number
  headers: [string, string][]
  timing: number
}

function App() {
  const [results, setResults] = useState<Record<string, FetchResult>>({})
  const [cachePreset, setCachePreset] = useState(CACHE_PRESETS[1])
  const [useEtag, setUseEtag] = useState(false)

  async function probe(path: string, key: string, opts?: RequestInit) {
    const start = performance.now()
    const res = await fetch(path, { cache: 'default', ...opts })
    const timing = performance.now() - start
    const headers: [string, string][] = []
    res.headers.forEach((value, name) => headers.push([name, value]))
    setResults((prev) => ({
      ...prev,
      [key]: { path, status: res.status, headers, timing },
    }))
  }

  function dynamicUrl() {
    const params = new URLSearchParams({ cache: cachePreset })
    if (useEtag) params.set('etag', '1')
    return `/api/dynamic?${params.toString()}`
  }

  useEffect(() => {
    STATIC_ASSETS.forEach((asset) => probe(asset.path, asset.path))
    probe(dynamicUrl(), 'dynamic', { cache: 'no-store' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main id="lab">
      <header>
        <h1>Cloudflare Pages · Cache-Control Lab</h1>
        <p>
          Fetch each asset below (open DevTools → Network to watch{' '}
          <code>Cache-Control</code>). Static rules live in{' '}
          <code>public/_headers</code>; the dynamic one comes from a Pages
          Function so you can change the header without redeploying.
        </p>
      </header>

      <section>
        <h2>Static assets (rules in <code>_headers</code>)</h2>
        <div className="grid">
          {STATIC_ASSETS.map((asset) => {
            const r = results[asset.path]
            return (
              <div className="card" key={asset.path}>
                <code className="path">{asset.path}</code>
                <p className="rule">{asset.rule}</p>
                <button onClick={() => probe(asset.path, asset.path)}>
                  Fetch
                </button>
                {r && (
                  <div className="result">
                    <div>status {r.status} · {r.timing.toFixed(1)}ms</div>
                    <ul>
                      {r.headers
                        .filter(([n]) =>
                          ['cache-control', 'age', 'etag', 'x-cache-lab'].includes(n),
                        )
                        .map(([n, v]) => (
                          <li key={n}>
                            <b>{n}</b>: {v}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2>Dynamic asset (Pages Function, live-tunable)</h2>
        <p>
          Presets with <code>s-maxage</code> set a different TTL for the CDN
          edge than <code>max-age</code> sets for the browser. This probe
          always fetches with <code>cache: 'no-store'</code> so every click
          hits the network instead of your browser's own HTTP cache — that
          way <code>X-Cache</code> reflects the edge Cache API simulation, not
          a locally-cached response replaying old headers.
        </p>
        <div className="controls">
          <label>
            Cache-Control
            <select value={cachePreset} onChange={(e) => setCachePreset(e.target.value)}>
              {CACHE_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={useEtag}
              onChange={(e) => setUseEtag(e.target.checked)}
            />
            send ETag
          </label>
          <button onClick={() => probe(dynamicUrl(), 'dynamic', { cache: 'no-store' })}>Fetch</button>
        </div>
        {results.dynamic && (
          <div className="result">
            <div>
              status {results.dynamic.status} · {results.dynamic.timing.toFixed(1)}ms
            </div>
            <ul>
              {results.dynamic.headers.map(([n, v]) => (
                <li key={n}>
                  <b>{n}</b>: {v}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <footer>
        <p>
          Run <code>npx wrangler pages dev -- npm run dev</code> locally, or{' '}
          <code>npm run build && npx wrangler pages deploy dist</code> to push
          to Cloudflare.
        </p>
      </footer>
    </main>
  )
}

export default App
