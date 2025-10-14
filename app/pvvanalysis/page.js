import 'server-only'
import { queryDuckDB } from '@/lib/duck'
import VolCharts from './VolCharts'
import TickerDashboardClient from './TickerDashboardClient'
import { ArrowUp, ArrowDown } from 'lucide-react'
import DownloadButtons from './DownloadButtons'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ============================ CONFIG ============================ */
const RETURN_METRICS = [
  '20_day_ret','60_day_ret','300_day_ret',
  'change_10dayret','60d_return_accel',
  'moving_avg_20d','moving_avg_50d','moving_avg_200d',
]
const VOL_METRICS = [
  '15d_volatility','60d_volatility','252d_volatility',
  '60d_upsidevolatility','60d_downsidedeviation',
]
const VOLUME_METRICS = [
  'vol_accel_5d','vol_accel_10d','abn_vol_60d','252d_dollar_volume_accel',
]
const VOLUME_SMA_METRICS = ['60d_dollar_volume_SMA','252d_dollar_volume_SMA']

/* ============================ SMALL UTILS ============================ */
function toSafeTicker(t) {
  return String(t || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '')
}
function toYMD(d) {
  if (d == null) return ''
  if (typeof d === 'string') {
    const i = d.indexOf('T')
    return (i > 0 ? d.slice(0, i) : d).slice(0, 10)
  }
  if (d instanceof Date) {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return String(d).slice(0, 10)
}
const num = (x) => (x === null || x === undefined ? null : Number(x))
const pct = (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(2)}%`)
const fmt = (v, d = 3) => (v == null ? '—' : Number(v).toFixed(d))

/* ============================ CLASSIFIERS — RETURNS ============================ */
const LEVEL_COLOR = {
  '-3':'bg-red-700','-2':'bg-red-500','-1':'bg-red-300',
  '0':'bg-gray-300','1':'bg-green-300','2':'bg-green-500','3':'bg-green-700',
}
function ColorBox({ cat }) {
  const key = String(cat ?? 0)
  const cls = LEVEL_COLOR[key] ?? LEVEL_COLOR['0']
  return <div className={`h-5 w-5 rounded ${cls}`} aria-label={`level-${key}`} />
}
function RocArrow({ up }) {
  return (
    <div className="h-5 w-5 flex items-center justify-center" aria-label={up ? 'roc-up' : 'roc-down'}>
      {up ? <ArrowUp className="h-4 w-4 text-green-600" /> : <ArrowDown className="h-4 w-4 text-red-600" />}
    </div>
  )
}
function PlainArrow({ up }) {
  return (
    <div className="h-5 w-5 flex items-center justify-center" aria-label={up ? 'up' : 'down'}>
      {up ? <ArrowUp className="h-4 w-4 text-gray-700" /> : <ArrowDown className="h-4 w-4 text-gray-700" />}
    </div>
  )
}
function classifySTPrice(ret20) {
  const r = num(ret20)
  if (r === null) return 0
  if (r >= 0.1) return 3
  if (r >= 0.05) return 2
  if (r > 0.0) return 1
  if (r <= -0.1) return -3
  if (r <= -0.05) return -2
  if (r < 0.0) return -1
  return 0
}
function classifyMTPrice(ret60, ma20, ma50) {
  let cat = 0
  const r = num(ret60)
  if (r !== null) {
    if (r >= 0.15) cat = 3
    else if (r >= 0.07) cat = 2
    else if (r > 0.0) cat = 1
    else if (r <= -0.15) cat = -3
    else if (r <= -0.07) cat = -2
    else if (r < 0.0) cat = -1
  }
  const a = num(ma20), b = num(ma50)
  if (a !== null && b !== null) {
    if (a > b) cat = Math.min(3, cat + 1)
    if (a < b) cat = Math.max(-3, cat - 1)
  }
  return cat
}
function classifyLTPrice(ret300, ma50, ma200) {
  let cat = 0
  const r = num(ret300)
  if (r !== null) {
    if (r >= 0.25) cat = 3
    else if (r >= 0.15) cat = 2
    else if (r > 0.0) cat = 1
    else if (r <= -0.25) cat = -3
    else if (r <= -0.15) cat = -2
    else if (r < 0.0) cat = -1
  }
  const a = num(ma50), b = num(ma200)
  if (a !== null && b !== null) {
    if (a > b) cat = Math.min(3, cat + 1)
    if (a < b) cat = Math.max(-3, cat - 1)
  }
  return cat
}
const rocST = (chg10) => (num(chg10) === null ? null : num(chg10) > 0)
const rocMT = (acc60) => (num(acc60) === null ? null : num(acc60) > 0)

/* ============================ CLASSIFIERS — VOLATILITY ============================ */
const classifySTVol = (v) => {
  if (v == null) return { label: '—', cls: 'bg-gray-300' }
  if (v < 0.01) return { label: 'Low', cls: 'bg-sky-300' }
  if (v < 0.02) return { label: 'Medium', cls: 'bg-emerald-400' }
  if (v < 0.03) return { label: 'High', cls: 'bg-amber-500' }
  return { label: 'Very High', cls: 'bg-rose-600' }
}
const classifyMTVol = (v) => {
  if (v == null) return { label: '—', cls: 'bg-gray-300' }
  if (v < 0.008) return { label: 'Low', cls: 'bg-sky-300' }
  if (v < 0.015) return { label: 'Medium', cls: 'bg-emerald-400' }
  if (v < 0.025) return { label: 'High', cls: 'bg-amber-500' }
  return { label: 'Very High', cls: 'bg-rose-600' }
}
const classifyLTVol = (v) => {
  if (v == null) return { label: '—', cls: 'bg-gray-300' }
  if (v < 0.007) return { label: 'Low', cls: 'bg-sky-300' }
  if (v < 0.012) return { label: 'Medium', cls: 'bg-emerald-400' }
  if (v < 0.02) return { label: 'High', cls: 'bg-amber-500' }
  return { label: 'Very High', cls: 'bg-rose-600' }
}

/* ============================ DATA LOADERS ============================ */
async function loadAllTickers() {
  return await queryDuckDB(`
    SELECT ticker, COALESCE(name, ticker) AS name
    FROM dim_ticker
    ORDER BY ticker;
  `)
}
async function loadProfile(safeTicker) {
  const [row] = await queryDuckDB(`
    SELECT
      ticker_id, ticker, COALESCE(name, ticker) AS name,
      market_cap, beta, employees, industry, headquarters, exchange,
      gics_sector, gics_subsector
    FROM dim_ticker
    WHERE ticker = '${safeTicker}'
    LIMIT 1;
  `)
  return row ?? null
}
async function loadFiveYearPrices(ticker_id) {
  const rows = await queryDuckDB(`
    WITH maxd AS (
      SELECT MAX(p.dt) AS max_dt
      FROM fact_price_daily p
      WHERE p.ticker_id = ${ticker_id}
    )
    SELECT p.dt, p.open, p.high, p.low, p.close, p.adj_close, p.volume
    FROM fact_price_daily p, maxd
    WHERE p.ticker_id = ${ticker_id}
      AND p.dt >= (maxd.max_dt - INTERVAL '5 years')
    ORDER BY p.dt;
  `)
  return (rows ?? []).map(r => ({ ...r, dt: toYMD(r.dt) }))
}
async function loadSnapshotLatestMetrics(ticker_id) {
  const rows = await queryDuckDB(`
    SELECT m.metric_code, s.value, s.dt AS date
    FROM snapshot_metric_latest s
    JOIN dim_metric m ON m.metric_id = s.metric_id
    WHERE s.ticker_id = ${ticker_id}
    ORDER BY m.metric_code;
  `)
  const normalized = (rows ?? []).map(r => ({ ...r, date: toYMD(r.date) }))
  return { rows: normalized, latestDate: normalized?.length ? normalized[0].date : null }
}
async function loadPVVLatestBundle(ticker_id) {
  const needed = [...new Set([...RETURN_METRICS, ...VOL_METRICS, ...VOLUME_METRICS])]
  const rows = await queryDuckDB(`
    WITH m AS (
      SELECT f.ticker_id, dm.metric_code, f.value, f.dt,
             ROW_NUMBER() OVER (PARTITION BY f.ticker_id, f.metric_id ORDER BY f.dt DESC) AS rn
      FROM fact_metric_daily f
      JOIN dim_metric dm USING (metric_id)
      WHERE f.ticker_id = ${ticker_id}
        AND dm.metric_code IN (${needed.map((c) => `'${c}'`).join(', ')})
    )
    SELECT metric_code, value FROM m WHERE rn = 1;
  `)
  const byCode = Object.fromEntries((rows ?? []).map((r) => [r.metric_code, r.value]))
  return {
    ret20: byCode['20_day_ret'] ?? null,
    ret60: byCode['60_day_ret'] ?? null,
    ret300: byCode['300_day_ret'] ?? null,
    chg10: byCode['change_10dayret'] ?? null,
    accel60: byCode['60d_return_accel'] ?? null,
    ma20: byCode['moving_avg_20d'] ?? null,
    ma50: byCode['moving_avg_50d'] ?? null,
    ma200: byCode['moving_avg_200d'] ?? null,
    vol15: byCode['15d_volatility'] ?? null,
    vol60: byCode['60d_volatility'] ?? null,
    vol252: byCode['252d_volatility'] ?? null,
    up60: byCode['60d_upsidevolatility'] ?? null,
    down60: byCode['60d_downsidedeviation'] ?? null,
    vol_accel_5d: byCode['vol_accel_5d'] ?? null,
    vol_accel_10d: byCode['vol_accel_10d'] ?? null,
    abn_vol_60d: byCode['abn_vol_60d'] ?? null,
    dv_accel_252: byCode['252d_dollar_volume_accel'] ?? null,
  }
}
async function loadVolTimeseries(ticker_id, lookbackDays = 420) {
  const rows = await queryDuckDB(`
    WITH filtered AS (
      SELECT f.dt, dm.metric_code, f.value
      FROM fact_metric_daily f
      JOIN dim_metric dm USING (metric_id)
      WHERE f.ticker_id = ${ticker_id}
        AND dm.metric_code IN (${VOL_METRICS.map((m) => `'${m}'`).join(', ')})
    )
    SELECT
      dt,
      MAX(CASE WHEN metric_code='15d_volatility'        THEN value END) AS vol15,
      MAX(CASE WHEN metric_code='60d_volatility'        THEN value END) AS vol60,
      MAX(CASE WHEN metric_code='252d_volatility'       THEN value END) AS vol252,
      MAX(CASE WHEN metric_code='60d_upsidevolatility'  THEN value END) AS up60,
      MAX(CASE WHEN metric_code='60d_downsidedeviation' THEN value END) AS down60
    FROM filtered
    GROUP BY dt
    ORDER BY dt DESC
    LIMIT ${lookbackDays};
  `)
  return (rows ?? [])
    .sort((a, b) => new Date(toYMD(a.dt)) - new Date(toYMD(b.dt)))
    .map((r) => ({
      date: toYMD(r.dt),
      vol15: r.vol15 ?? null,
      vol60: r.vol60 ?? null,
      vol252: r.vol252 ?? null,
      up60: r.up60 ?? null,
      down60: r.down60 ?? null,
    }))
}
async function loadDollarVolSMAs(ticker_id, lookbackDays = 420) {
  const rows = await queryDuckDB(`
    WITH filtered AS (
      SELECT f.dt, dm.metric_code, f.value
      FROM fact_metric_daily f
      JOIN dim_metric dm USING (metric_id)
      WHERE f.ticker_id = ${ticker_id}
        AND dm.metric_code IN (${VOLUME_SMA_METRICS.map((m) => `'${m}'`).join(', ')})
    )
    SELECT
      dt,
      MAX(CASE WHEN metric_code='60d_dollar_volume_SMA'  THEN value END) AS dv_sma_60,
      MAX(CASE WHEN metric_code='252d_dollar_volume_SMA' THEN value END) AS dv_sma_252
    FROM filtered
    GROUP BY dt
    ORDER BY dt DESC
    LIMIT ${lookbackDays};
  `)
  return (rows ?? [])
    .sort((a, b) => new Date(toYMD(a.dt)) - new Date(toYMD(b.dt)))
    .map((r) => ({
      date: toYMD(r.dt),
      dvSMA60: r.dv_sma_60 ?? null,
      dvSMA252: r.dv_sma_252 ?? null,
    }))
}

/* ============================ PAGE ============================ */
export default async function Page({ searchParams }) {
  const allTickers = await loadAllTickers()
  if (!allTickers?.length) {
    return (
      <main id="pvv-root" className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold mb-2">PVV Dashboard</h1>
          <p className="text-sm text-gray-600">No tickers found in dim_ticker.</p>
        </div>
      </main>
    )
  }

  const selectedTicker = toSafeTicker(searchParams?.t || searchParams?.ticker || allTickers[0].ticker)
  const profile = await loadProfile(selectedTicker)
  if (!profile) {
    return (
      <main id="pvv-root" className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <h1 className="text-2xl font-bold mb-2">PVV Dashboard</h1>
          <p className="text-sm text-red-600">Ticker "{selectedTicker}" not found.</p>
        </div>
      </main>
    )
  }

  const priceRows = await loadFiveYearPrices(profile.ticker_id)
  const { rows: snapshotMetrics, latestDate: latestMetricDate } = await loadSnapshotLatestMetrics(profile.ticker_id)
  const latest = await loadPVVLatestBundle(profile.ticker_id)
  const volSeries = await loadVolTimeseries(profile.ticker_id, 420)
  const dvSMASeries = await loadDollarVolSMAs(profile.ticker_id, 420)

  const stLevel = classifySTPrice(latest.ret20)
  const mtLevel = classifyMTPrice(latest.ret60, latest.ma20, latest.ma50)
  const ltLevel = classifyLTPrice(latest.ret300, latest.ma50, latest.ma200)
  const stRocUp = rocST(latest.chg10)
  const mtRocUp = rocMT(latest.accel60)

  const stVol = classifySTVol(latest.vol15)
  const mtVol = classifyMTVol(latest.vol60)
  const ltVol = classifyLTVol(latest.vol252)

  const stVolAccelUp =
    latest.vol_accel_5d == null || latest.vol_accel_10d == null
      ? null
      : Number(latest.vol_accel_5d) + Number(latest.vol_accel_10d) > 0
  const mtAbnVolUp = latest.abn_vol_60d == null ? null : Number(latest.abn_vol_60d) > 0
  const ltDollarVolAccelUp = latest.dv_accel_252 == null ? null : Number(latest.dv_accel_252) > 0

  const todayStr = toYMD(new Date())
  const pdfName = `${profile.ticker}_PVV_${todayStr}.pdf`

  return (
    <main id="pvv-root" className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-8">
        {/* Header + controls */}
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">PVV Dashboard</h1>
            <p className="text-sm text-gray-600">
              Viewing <span className="font-medium">{profile.ticker}</span>
              {profile.name && profile.name !== profile.ticker ? ` — ${profile.name}` : ''}.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 md:items-end">
            <TickerDashboardClient
              mode="header-controls"
              allTickers={allTickers}
              selectedTicker={profile.ticker}
            />
            <DownloadButtons targetId="pvv-root" filename={pdfName} />
          </div>
        </div>

        {/* Company profile */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border rounded-xl p-4">
            <div className="text-xs uppercase text-gray-500 mb-1">Exchange</div>
            <div className="text-sm">{profile.exchange ?? '-'}</div>
            <div className="text-xs uppercase text-gray-500 mt-3 mb-1">Headquarters</div>
            <div className="text-sm">{profile.headquarters ?? '-'}</div>
          </div>
          <div className="border rounded-xl p-4">
            <div className="text-xs uppercase text-gray-500 mb-1">Industry</div>
            <div className="text-sm">{profile.industry ?? '-'}</div>
            <div className="text-xs uppercase text-gray-500 mt-3 mb-1">GICS</div>
            <div className="text-sm">
              {(profile.gics_sector ?? '-') + ' / ' + (profile.gics_subsector ?? '-')}
            </div>
          </div>
          <div className="border rounded-xl p-4">
            <div className="text-xs uppercase text-gray-500 mb-1">Market Cap</div>
            <div className="text-sm">{profile.market_cap ?? '-'}</div>
            <div className="text-xs uppercase text-gray-500 mt-3 mb-1">Beta</div>
            <div className="text-sm">{profile.beta ?? '-'}</div>
          </div>
        </section>

        {/* PRICE CHART + DAILY METRICS */}
        <section className="rounded-xl border bg-white p-4">
          <TickerDashboardClient
            mode="content"
            selectedTicker={profile.ticker}
            priceRows={priceRows}
            metricRows={snapshotMetrics}
            latestMetricDate={latestMetricDate}
          />
        </section>

        {/* RETURNS */}
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Return Analysis</h2>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-[140px_repeat(6,1fr)] items-center gap-2 px-2 py-2 text-xs font-medium text-gray-600">
                <div className="px-2">Ticker</div>
                <div className="text-center">ST Level</div>
                <div className="text-center">ST ROC</div>
                <div className="text-center">MT Level</div>
                <div className="text-center">MT ROC</div>
                <div className="text-center">LT Level</div>
                <div className="text-center">LT ROC</div>
              </div>
              <div className="divide-y rounded-lg border bg-white">
                <div className="grid grid-cols-[140px_repeat(6,1fr)] items-center gap-2 px-2 py-3">
                  <div className="px-2 font-semibold">{profile.ticker}</div>
                  <div className="flex items-center justify-center"><ColorBox cat={stLevel} /></div>
                  <div className="flex items-center justify-center">
                    {stRocUp === null ? <div className="h-5 w-5 rounded bg-gray-200" /> : <RocArrow up={!!stRocUp} />}
                  </div>
                  <div className="flex items-center justify-center"><ColorBox cat={mtLevel} /></div>
                  <div className="flex items-center justify-center">
                    {mtRocUp === null ? <div className="h-5 w-5 rounded bg-gray-200" /> : <RocArrow up={!!mtRocUp} />}
                  </div>
                  <div className="flex items-center justify-center"><ColorBox cat={ltLevel} /></div>
                  <div className="flex items-center justify-center"><div className="h-5 w-5 rounded bg-gray-200" /></div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500">
            ST: <code>20_day_ret</code> &amp; <code>change_10dayret</code> • MT: <code>60_day_ret</code> (+ MA20 vs MA50 bump) &amp; <code>60d_return_accel</code> • LT: <code>300_day_ret</code> (+ MA50 vs MA200 bump)
          </div>
        </section>

        {/* VOLATILITY */}
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Volatility</h2>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-6">Horizon</th>
                  <th className="py-2 pr-6">Metric</th>
                  <th className="py-2 pr-6">Value</th>
                  <th className="py-2">Class</th>
                </tr>
              </thead>
              <tbody className="align-middle">
                <tr className="border-t">
                  <td className="py-3 pr-6 font-medium">ST</td>
                  <td className="py-3 pr-6"><code>15d_volatility</code></td>
                  <td className="py-3 pr-6">{pct(latest.vol15)}</td>
                  <td className="py-3"><span className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs text-white ${stVol.cls}`}>{stVol.label}</span></td>
                </tr>
                <tr className="border-t">
                  <td className="py-3 pr-6 font-medium">MT</td>
                  <td className="py-3 pr-6"><code>60d_volatility</code></td>
                  <td className="py-3 pr-6">{pct(latest.vol60)}</td>
                  <td className="py-3"><span className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs text-white ${mtVol.cls}`}>{mtVol.label}</span></td>
                </tr>
                <tr className="border-t">
                  <td className="py-3 pr-6 font-medium">LT</td>
                  <td className="py-3 pr-6"><code>252d_volatility</code></td>
                  <td className="py-3 pr-6">{pct(latest.vol252)}</td>
                  <td className="py-3"><span className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs text-white ${ltVol.cls}`}>{ltVol.label}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
            <div><div className="font-medium">ST: <code>15d_volatility</code></div><div>&lt;1.0% Low • 1.0–2.0% Med • 2.0–3.0% High • &gt;3.0% Very High</div></div>
            <div><div className="font-medium">MT: <code>60d_volatility</code></div><div>&lt;0.8% Low • 0.8–1.5% Med • 1.5–2.5% High • &gt;2.5% Very High</div></div>
            <div><div className="font-medium">LT: <code>252d_volatility</code></div><div>&lt;0.7% Low • 0.7–1.2% Med • 1.2–2.0% High • &gt;2.0% Very High</div></div>
          </div>

          <div className="mt-6">
            <VolCharts
              series={volSeries}
              leftKeys={['vol15','vol60','vol252']}
              rightKeys={['up60','down60']}
            />
          </div>
        </section>

        {/* VOLUME */}
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold">Volume</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="min-w-[600px] text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2 pr-6">Horizon</th>
                    <th className="py-2 pr-6">Metric Code(s)</th>
                    <th className="py-2 pr-6">Value</th>
                    <th className="py-2">Level</th>
                  </tr>
                </thead>
                <tbody className="align-middle">
                  <tr className="border-t">
                    <td className="py-3 pr-6 font-medium">ST</td>
                    <td className="py-3 pr-6"><code>vol_accel_5d</code> + <code>vol_accel_10d</code></td>
                    <td className="py-3 pr-6">
                      {fmt(latest.vol_accel_5d)} + {fmt(latest.vol_accel_10d)} ={' '}
                      {latest.vol_accel_5d == null || latest.vol_accel_10d == null
                        ? '—'
                        : fmt(Number(latest.vol_accel_5d) + Number(latest.vol_accel_10d))}
                    </td>
                    <td className="py-3">
                      {stVolAccelUp === null ? <div className="h-5 w-5 rounded bg-gray-200" /> : <PlainArrow up={stVolAccelUp} />}
                    </td>
                  </tr>
                  <tr className="border-t">
                    <td className="py-3 pr-6 font-medium">MT</td>
                    <td className="py-3 pr-6"><code>abn_vol_60d</code></td>
                    <td className="py-3 pr-6">{fmt(latest.abn_vol_60d)}</td>
                    <td className="py-3">
                      {mtAbnVolUp === null ? <div className="h-5 w-5 rounded bg-gray-200" /> : <PlainArrow up={mtAbnVolUp} />}
                    </td>
                  </tr>
                  <tr className="border-t">
                    <td className="py-3 pr-6 font-medium">LT</td>
                    <td className="py-3 pr-6"><code>252d_dollar_volume_accel</code></td>
                    <td className="py-3 pr-6">{fmt(latest.dv_accel_252)}</td>
                    <td className="py-3">
                      {ltDollarVolAccelUp === null ? <div className="h-5 w-5 rounded bg-gray-200" /> : <PlainArrow up={ltDollarVolAccelUp} />}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3 text-xs text-gray-500">
                Volume arrows indicate direction only: ST uses the sum of <code>vol_accel_5d</code> and <code>vol_accel_10d</code>; MT uses <code>abn_vol_60d</code>; LT uses <code>252d_dollar_volume_accel</code>.
              </div>
            </div>

            <div className="mt-4 md:mt-0">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Dollar-Volume SMAs (60d vs 252d)</h3>
              <VolCharts series={dvSMASeries} leftKeys={['dvSMA60','dvSMA252']} rightKeys={[]} format="number" />
              <div className="mt-2 text-xs text-gray-500">
                Plotted: <code>60d_dollar_volume_SMA</code> and <code>252d_dollar_volume_SMA</code>.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
