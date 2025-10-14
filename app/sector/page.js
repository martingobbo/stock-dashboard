import 'server-only'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { queryDuckDB } from '@/lib/duck'

const DB_PATH = '/Users/martingobbo/stock-dashboard/data/serving/analytics.duckdb'

const SECTOR_ETFS = ['XLK','XLF','XLI','XLY','XLP','XLV','XLE','XLU','XLB','XLC','XLRE']

// Friendly display names (now aligned to your requested wording)
const SECTOR_LABEL = {
  XLK:'Technology',
  XLF:'Financial Services',     // was "Financials"
  XLI:'Industrials',
  XLY:'Consumer Cyclical',      // was "Consumer Discretionary"
  XLP:'Consumer Defensive',     // was "Consumer Staples"
  XLV:'Healthcare',             // was "Health Care"
  XLE:'Energy',
  XLU:'Utilities',
  XLB:'Basic Materials',        // was "Materials"
  XLC:'Communication Services',
  XLRE:'Real Estate',
}

// Canonical slugs that match your dim_ticker normalization
const SECTOR_SLUG = {
  XLK:'technology',
  XLF:'financial-services',
  XLI:'industrials',
  XLY:'consumer-cyclical',
  XLP:'consumer-defensive',
  XLV:'healthcare',
  XLE:'energy',
  XLU:'utilities',
  XLB:'basic-materials',
  XLC:'communication-services',
  XLRE:'real-estate',
}

// Accept common alias slugs and map to your canonical DB slugs
const SLUG_ALIAS = {
  'consumer-discretionary': 'consumer-cyclical',
  'consumer-staples': 'consumer-defensive',
  'health-care': 'healthcare',
  'materials': 'basic-materials',
  'financials': 'financial-services',
}

// Inverse map: canonical slug -> friendly label
const SLUG_TO_LABEL = Object.fromEntries(
  Object.entries(SECTOR_SLUG).map(([etf, slug]) => [slug, SECTOR_LABEL[etf] ?? etf])
)

// Normalize any incoming slug to the canonical DB slug
function normalizeSectorSlug(slug) {
  if (!slug) return slug
  const s = slug.toLowerCase()
  return SLUG_ALIAS[s] ?? s
}

/* ---------- Sector companies/best/worst (only when slug provided) ---------- */
async function getSectorData(slug) {
  const duckdb = (await import('duckdb')).default
  const db = new duckdb.Database(DB_PATH)
  const con = db.connect()

  const companies = await new Promise((resolve, reject) =>
    con.all(
      `
      WITH normalized AS (
        SELECT gics_sector,
               LOWER(regexp_replace(gics_sector, '[^0-9A-Za-z]+', '-')) AS sector_slug
        FROM dim_ticker
      ),
      m300 AS (SELECT metric_id FROM dim_metric WHERE metric_code = '300_day_ret'),
      latest300 AS (
        SELECT f.ticker_id, f.value AS ret300
        FROM fact_metric_daily f
        JOIN m300 ON f.metric_id = m300.metric_id
        JOIN (
          SELECT fmd.ticker_id, max(fmd.dt) AS max_dt
          FROM fact_metric_daily fmd
          JOIN m300 ON fmd.metric_id = m300.metric_id
          GROUP BY fmd.ticker_id
        ) mx ON f.ticker_id = mx.ticker_id AND f.dt = mx.max_dt
      )
      SELECT t.name, t.ticker, t.gics_subsector, t.industry, t.market_cap, t.gics_sector, l300.ret300
      FROM dim_ticker t
      LEFT JOIN latest300 l300 ON l300.ticker_id = t.ticker_id
      WHERE t.gics_sector IN (SELECT gics_sector FROM normalized WHERE sector_slug = ?)
      ORDER BY t.market_cap DESC NULLS LAST, t.ticker
      `,
      [slug],
      (err, res) => (err ? reject(err) : resolve(res))
    )
  )

  const best = await new Promise((resolve, reject) =>
    con.all(
      `
      WITH normalized AS (
        SELECT gics_sector,
               LOWER(regexp_replace(gics_sector, '[^0-9A-Za-z]+', '-')) AS sector_slug
        FROM dim_ticker
      ),
      m60 AS (SELECT metric_id FROM dim_metric WHERE metric_code = '60_day_ret'),
      latest60 AS (
        SELECT f.ticker_id, f.value AS ret60
        FROM fact_metric_daily f
        JOIN m60 ON f.metric_id = m60.metric_id
        JOIN (
          SELECT fmd.ticker_id, max(fmd.dt) AS max_dt
          FROM fact_metric_daily fmd
          JOIN m60 ON fmd.metric_id = m60.metric_id
          GROUP BY fmd.ticker_id
        ) mx ON f.ticker_id = mx.ticker_id AND f.dt = mx.max_dt
      )
      SELECT t.ticker, t.name, l60.ret60
      FROM dim_ticker t
      JOIN latest60 l60 ON l60.ticker_id = t.ticker_id
      WHERE t.gics_sector IN (SELECT gics_sector FROM normalized WHERE sector_slug = ?)
      ORDER BY l60.ret60 DESC
      LIMIT 5
      `,
      [slug],
      (err, res) => (err ? reject(err) : resolve(res))
    )
  )

  const worst = await new Promise((resolve, reject) =>
    con.all(
      `
      WITH normalized AS (
        SELECT gics_sector,
               LOWER(regexp_replace(gics_sector, '[^0-9A-Za-z]+', '-')) AS sector_slug
        FROM dim_ticker
      ),
      m60 AS (SELECT metric_id FROM dim_metric WHERE metric_code = '60_day_ret'),
      latest60 AS (
        SELECT f.ticker_id, f.value AS ret60
        FROM fact_metric_daily f
        JOIN m60 ON f.metric_id = m60.metric_id
        JOIN (
          SELECT fmd.ticker_id, max(fmd.dt) AS max_dt
          FROM fact_metric_daily fmd
          JOIN m60 ON fmd.metric_id = m60.metric_id
          GROUP BY fmd.ticker_id
        ) mx ON f.ticker_id = mx.ticker_id AND f.dt = mx.max_dt
      )
      SELECT t.ticker, t.name, l60.ret60
      FROM dim_ticker t
      JOIN latest60 l60 ON l60.ticker_id = t.ticker_id
      WHERE t.gics_sector IN (SELECT gics_sector FROM normalized WHERE sector_slug = ?)
      ORDER BY l60.ret60 ASC
      LIMIT 5
      `,
      [slug],
      (err, res) => (err ? reject(err) : resolve(res))
    )
  )

  con.close()
  return { companies, best, worst }
}

/* ---------- Sector ETF overview (always) ---------- */
async function loadSectorEtfPerformance() {
  const inList = SECTOR_ETFS.map(s => `'${s}'`).join(',')
  const rows = await queryDuckDB(`
    WITH ids AS (
      SELECT ticker_id, ticker FROM dim_ticker WHERE ticker IN (${inList})
    ),
    last_dt AS (SELECT max(dt) AS max_dt FROM fact_price_daily)
    SELECT i.ticker, f.dt, f.adj_close
    FROM fact_price_daily f
    JOIN ids i ON i.ticker_id = f.ticker_id
    WHERE f.dt >= (SELECT max_dt - INTERVAL '400 days' FROM last_dt)
    ORDER BY i.ticker, f.dt;
  `)

  const by = new Map()
  for (const r of rows) {
    const k = r.ticker
    if (!by.has(k)) by.set(k, [])
    by.get(k).push({ dt: new Date(r.dt), px: Number(r.adj_close) })
  }

  const N5=5, N21=21, N63=63, N252=252, N60=60
  const out = []
  for (const t of SECTOR_ETFS) {
    const s = (by.get(t) || []).sort((a,b)=>a.dt-b.dt)
    const closes = s.map(v=>v.px)
    const last = closes.length - 1
    const lagRet = lag => (last-lag>=0 && closes[last-lag]>0) ? (closes[last]/closes[last-lag]-1) : null
    const ret_5d = lagRet(N5), ret_1m = lagRet(N21), ret_3m = lagRet(N63), ret_1y = lagRet(N252)

    // 60d ann vol
    let vol_60d = null
    if (closes.length >= N60+1) {
      const tail = closes.slice(-(N60+1))
      const logs = []
      for (let i=1;i<tail.length;i++) {
        const r = Math.log(tail[i]/tail[i-1])
        if (Number.isFinite(r)) logs.push(r)
      }
      if (logs.length>1) {
        const mu = logs.reduce((a,b)=>a+b,0)/logs.length
        const v = logs.reduce((a,b)=>a+(b-mu)*(b-mu),0)/(logs.length-1)
        vol_60d = Math.sqrt(v)*Math.sqrt(252)
      }
    }

    const sparkBase = closes.slice(-N60)
    const base = sparkBase[0]
    const spark = base ? sparkBase.map(v=> (v/base)*100) : []

    out.push({
      ticker: t,
      name: SECTOR_LABEL[t] ?? t,
      ret_5d, ret_1m, ret_3m, ret_1y,
      vol_60d,
      spark,
    })
  }

  for (const r of out) {
    const arr = [r.ret_5d,r.ret_1m,r.ret_3m,r.ret_1y].filter(x=>x!=null)
    r.momo = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null
  }
  const ranked = [...out].sort((a,b)=>(b.momo ?? -1e9)-(a.momo ?? -1e9))
  const rankMap = new Map(ranked.map((r,i)=>[r.ticker,i+1]))
  for (const r of out) r.rank = rankMap.get(r.ticker) ?? null
  out.sort((a,b)=>(a.rank ?? 1e9)-(b.rank ?? 1e9))
  return out
}

/* ---------- Tiny server-side sparkline ---------- */
function Sparkline({ values, width=120, height=28, pad=2 }) {
  if (!values || values.length===0) return <svg width={width} height={height} />
  const w=width-2*pad, h=height-2*pad, n=values.length
  const min=Math.min(...values), max=Math.max(...values), span=max-min||1
  const x=i=> pad + (i/(n-1))*w
  const y=v=> pad + (1-((v-min)/span))*h
  let d=`M ${x(0)} ${y(values[0])}`
  for(let i=1;i<n;i++) d+=` L ${x(i)} ${y(values[i])}`
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
}

/* ---------- Formatters ---------- */
function fmtCap(n){ if(n==null) return '—'
  const a=Math.abs(n)
  if(a>=1e12) return (n/1e12).toFixed(2)+'T'
  if(a>=1e9)  return (n/1e9).toFixed(2)+'B'
  if(a>=1e6)  return (n/1e6).toFixed(2)+'M'
  return Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n)
}
function fmtPct(n, dp=2){ return (n==null||Number.isNaN(n))?'—':(n*100).toFixed(dp)+'%' }

/* ---------- Page ---------- */
export default async function Page({ params = {} }) {
  const rawSlug = params?.slug  // may be undefined on /sector
  const slug = rawSlug ? normalizeSectorSlug(rawSlug) : undefined

  const [overview, sectorData] = await Promise.all([
    loadSectorEtfPerformance(),
    slug ? getSectorData(slug) : Promise.resolve({ companies: [], best: [], worst: [] }),
  ])

  // Prefer friendly label via canonical slug -> label; fall back to DB/slug title-casing
  const sectorName = slug
    ? (SLUG_TO_LABEL[slug] ??
       sectorData.companies[0]?.gics_sector ??
       rawSlug.replace(/-/g,' ').replace(/\b\w/g, m=>m.toUpperCase()))
    : 'All Sectors'

  const { companies, best, worst } = sectorData

  return (
    <main className="min-h-screen p-6 space-y-6">
      <div className="mb-2 flex items-center gap-3">
        {slug && <Link href="/sector" className="text-blue-600 hover:underline">← All Sectors</Link>}
        <h1 className="text-2xl font-bold">{sectorName}</h1>
      </div>

      {/* Performance Overview — always renders */}
      <div className="rounded-xl border overflow-x-auto">
        <div className="px-4 py-3 border-b bg-gray-50 font-semibold flex items-center gap-2">
          Performance Overview — Sector ETFs
          <span className="text-xs text-gray-500 font-normal">(5D, 1M, 3M, 1Y; Vol = 60d ann.)</span>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left p-3 font-semibold">Sector</th>
              <th className="text-left p-3 font-semibold">Ticker</th>
              <th className="text-right p-3 font-semibold">5D Return</th>
              <th className="text-right p-3 font-semibold">1M Return</th>
              <th className="text-right p-3 font-semibold">3M Return</th>
              <th className="text-right p-3 font-semibold">1Y Return</th>
              <th className="text-right p-3 font-semibold">Volatility (60d)</th>
              <th className="text-right p-3 font-semibold">Momentum Rank</th>
              <th className="text-left p-3 font-semibold">Sparkline (60d)</th>
            </tr>
          </thead>
          <tbody>
            {overview.map(r=>(
              <tr key={r.ticker} className="border-t">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.ticker}</td>
                <td className="p-3 text-right tabular-nums">{fmtPct(r.ret_5d)}</td>
                <td className="p-3 text-right tabular-nums">{fmtPct(r.ret_1m)}</td>
                <td className="p-3 text-right tabular-nums">{fmtPct(r.ret_3m)}</td>
                <td className="p-3 text-right tabular-nums">{fmtPct(r.ret_1y)}</td>
                <td className="p-3 text-right tabular-nums">{r.vol_60d==null?'—':(r.vol_60d*100).toFixed(2)+'%'}</td>
                <td className="p-3 text-right tabular-nums">{r.rank ?? '—'}</td>
                <td className="p-3"><div className="text-gray-700"><Sparkline values={r.spark} /></div></td>
              </tr>
            ))}
            {overview.length===0 && <tr><td colSpan={9} className="p-6 text-center text-gray-500">No data.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Sector-specific sections only if slug exists */}
      {slug && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border overflow-x-auto">
              <div className="px-4 py-3 border-b bg-gray-50 font-semibold">Best Performers — 60D Return</div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-3 font-semibold">Ticker</th>
                    <th className="text-left p-3 font-semibold">Company</th>
                    <th className="text-right p-3 font-semibold">60D Return</th>
                  </tr>
                </thead>
                <tbody>
                  {best.map((r,i)=>(
                    <tr key={r.ticker+i} className="border-t">
                      <td className="p-3 font-medium">{r.ticker}</td>
                      <td className="p-3">{r.name ?? '—'}</td>
                      <td className="p-3 text-right tabular-nums">{fmtPct(r.ret60)}</td>
                    </tr>
                  ))}
                  {best.length===0 && <tr><td colSpan={3} className="p-6 text-center text-gray-500">No data.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border overflow-x-auto">
              <div className="px-4 py-3 border-b bg-gray-50 font-semibold">Worst Performers — 60D Return</div>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-3 font-semibold">Ticker</th>
                    <th className="text-left p-3 font-semibold">Company</th>
                    <th className="text-right p-3 font-semibold">60D Return</th>
                  </tr>
                </thead>
                <tbody>
                  {worst.map((r,i)=>(
                    <tr key={r.ticker+i} className="border-t">
                      <td className="p-3 font-medium">{r.ticker}</td>
                      <td className="p-3">{r.name ?? '—'}</td>
                      <td className="p-3 text-right tabular-nums">{fmtPct(r.ret60)}</td>
                    </tr>
                  ))}
                  {worst.length===0 && <tr><td colSpan={3} className="p-6 text-center text-gray-500">No data.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 font-semibold">Company</th>
                  <th className="text-left p-3 font-semibold">Ticker</th>
                  <th className="text-left p-3 font-semibold">GICS Subsector</th>
                  <th className="text-left p-3 font-semibold">Industry</th>
                  <th className="text-right p-3 font-semibold">Market Cap</th>
                  <th className="text-right p-3 font-semibold">300D Return</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((r,i)=>(
                  <tr key={r.ticker+i} className="border-t">
                    <td className="p-3 font-medium">{r.name ?? '—'}</td>
                    <td className="p-3">{r.ticker}</td>
                    <td className="p-3">{r.gics_subsector ?? '—'}</td>
                    <td className="p-3">{r.industry ?? '—'}</td>
                    <td className="p-3 text-right tabular-nums">{fmtCap(r.market_cap)}</td>
                    <td className="p-3 text-right tabular-nums">{fmtPct(r.ret300)}</td>
                  </tr>
                ))}
                {companies.length===0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-gray-500">No companies found for this sector.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* === Links to All Sector Pages === */}
      <div className="pt-8">
        <h2 className="text-lg font-semibold mb-3">🧭 Explore Sectors</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {SECTOR_ETFS.map(t => {
            const name = SECTOR_LABEL[t]
            const slugPath = SECTOR_SLUG[t] // use canonical slug, not the label-derived slug
            return (
              <Link
                key={t}
                href={`/sector/${slugPath}`}
                className="block px-4 py-3 rounded-lg border hover:bg-gray-50 text-center font-medium text-sm"
              >
                {name}
              </Link>
            )
          })}
        </div>
      </div>
    </main>
  )
}
