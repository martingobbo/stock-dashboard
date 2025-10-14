// app/screener/page.js
// Server Component — Ultra Bullish + Bearish + Breakout Down tables, pulling metrics from DuckDB (dim_*/fact_metric_daily)
// Adds a "Download PDF" button that triggers the browser’s Print to PDF flow (no extra libs)

import 'server-only'
import { queryDuckDB } from '@/lib/duck'
import { Activity } from 'lucide-react'
import Script from 'next/script'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ============================ CONFIG ============================ */

// All metric_codes we need (exact strings must exist in dim_metric.metric_code)
const METRIC_CODES = [
  // Price
  'moving_avg_20d','moving_avg_50d','moving_avg_200d',
  '5_day_range_pos',
  'change_10dayret',
  'slope_over60_of_logprice','prior_slope_over60_of_logprice','60d_return_accel',
  '10_day_ret','60_day_ret','200_day_ret','300_day_ret', // <- added 200_day_ret

  // Volume
  'abn_vol_60d',
  '60d_price_dollarVolume_correlation',
  '252d_dollar_volume_accel',
  '60d_dollar_volume_SMA','252d_dollar_volume_SMA',

  // Volatility
  '252d_upsidevolatility','252d_downsidedeviation',
  'slope_over20_of_60d_volatility','slope_over60_of_252d_volatility',
  '5d_EMA_15dayvolatility','60d_volatility',
  '60_10_highlowrange_zscore', // <- added range zscore

  // Drawdown
  '750d_drawdown',
  'drawdown_percent' // 100d drawdown metric
]

/* ============================ HELPERS ============================ */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const pct = (x, dp = 2) => (x == null || isNaN(x)) ? 'N/A' : `${(Number(x) * 100).toFixed(dp)}%`
const num = (x, dp = 2) => (x == null || isNaN(x)) ? 'N/A' : Number(x).toFixed(dp)
const nz = (x) => (x == null || isNaN(x)) ? null : Number(x)

const toISOYYYYMMDD = (d) => {
  if (!d) return null
  if (d instanceof Date && !isNaN(d)) return d.toISOString().slice(0, 10)
  const s = String(d)
  const m = s.match(/\d{4}-\d{2}-\d{2}/)
  if (m) return m[0]
  const asDate = new Date(s)
  return isNaN(asDate) ? null : asDate.toISOString().slice(0, 10)
}

/* ============================ DATA LOAD ============================ */

async function loadUniverseCount() {
  const [{ cnt } = { cnt: 0 }] = await queryDuckDB(`
    SELECT COUNT(*)::INTEGER AS cnt
    FROM dim_ticker
    WHERE ticker IS NOT NULL AND LENGTH(TRIM(ticker)) > 0;
  `)
  return cnt
}

async function loadLatestMetricRows() {
  // 1) Resolve metric_codes -> metric_id
  const metRows = await queryDuckDB(`
    SELECT metric_code, metric_id
    FROM dim_metric
    WHERE metric_code IN (${METRIC_CODES.map(s => `'${s.replace(/'/g, "''")}'`).join(',')});
  `)
  if (!metRows?.length) return { latestDt: null, rowsByTicker: new Map(), universeCount: 0 }

  const codeToId = new Map(metRows.map(r => [r.metric_code, r.metric_id]))
  const idToCode  = new Map(metRows.map(r => [r.metric_id, r.metric_code]))
  const metricIdList = metRows.map(r => r.metric_id)
  const metricIdCSV  = metricIdList.join(',')

  // 2) Find latest DATE across these metrics (no ticker filter; use DATE to avoid TZ issues)
  const [latest] = await queryDuckDB(`
    SELECT MAX(CAST(dt AS DATE)) AS max_dt
    FROM fact_metric_daily
    WHERE metric_id IN (${metricIdCSV});
  `)
  const latestDateStr = toISOYYYYMMDD(latest?.max_dt)
  if (!latestDateStr) return { latestDt: null, rowsByTicker: new Map(), universeCount: 0 }

  // 3) Pull all metric values for that DATE for *all* tickers in dim_ticker, include sector
  const valRows = await queryDuckDB(`
    SELECT t.ticker,
           t.gics_sector,
           f.ticker_id,
           f.metric_id,
           f.value
    FROM fact_metric_daily f
    JOIN dim_ticker t USING (ticker_id)
    WHERE CAST(f.dt AS DATE) = DATE '${latestDateStr}'
      AND f.metric_id IN (${metricIdCSV})
      AND t.ticker IS NOT NULL
      AND LENGTH(TRIM(t.ticker)) > 0;
  `)

  // 4) Pivot into per-ticker objects keyed by metric_code; also stash sector
  const rowsByTicker = new Map()
  for (const r of valRows) {
    const code = idToCode.get(r.metric_id)
    if (!code) continue
    let obj = rowsByTicker.get(r.ticker)
    if (!obj) {
      obj = { ticker: r.ticker, gics_sector: r.gics_sector ?? null }
      rowsByTicker.set(r.ticker, obj)
    } else if (obj.gics_sector == null && r.gics_sector != null) {
      obj.gics_sector = r.gics_sector
    }
    const v = r.value
    obj[code] = (v == null || Number.isNaN(Number(v))) ? null : Number(v)
  }

  const universeCount = await loadUniverseCount()
  return { latestDt: latestDateStr, rowsByTicker, universeCount }
}

/* ============================ SCORING — BULLISH ============================ */

// Gatekeepers (must pass)
function passesGatekeepers(row) {
  const r10  = nz(row['10_day_ret'])
  const r60  = nz(row['60_day_ret'])
  const zAbn = nz(row['abn_vol_60d'])
  const corr = nz(row['60d_price_dollarVolume_correlation'])

  const priceOK = (r10 != null && r10 >= 0.02) && (r60 != null && r60 >= 0.05)
  const volOK   = ((zAbn != null && zAbn > 0.3) || (corr != null && corr > 0.5))
  return priceOK && volOK
}

// Price (max 45)
function scorePrice(row) {
  let pts = 0

  // MA state (12pts total) — proportional up to +6 each when MA is 10% above the lower MA
  const ma20 = nz(row['moving_avg_20d'])
  const ma50 = nz(row['moving_avg_50d'])
  const ma200 = nz(row['moving_avg_200d'])
  if (ma20 != null && ma50 != null && ma50 !== 0) {
    const rel = (ma20 / ma50) - 1
    if (rel > 0) pts += 6 * clamp(rel / 0.10, 0, 1)
  }
  if (ma50 != null && ma200 != null && ma200 !== 0) {
    const rel = (ma50 / ma200) - 1
    if (rel > 0) pts += 6 * clamp(rel / 0.10, 0, 1)
  }

  // Range / breakout (8pts): 8 × posInRange ∈ [0,1]
  const pos = clamp(nz(row['5_day_range_pos']) ?? 0, 0, 1)
  pts += 8 * pos

  // Return acceleration (7pts):
  const ch10 = nz(row['change_10dayret'])
  if (ch10 != null && ch10 > 0) pts += 4

  const s60  = nz(row['slope_over60_of_logprice'])
  const s60p = nz(row['prior_slope_over60_of_logprice'])
  const accel60 = nz(row['60d_return_accel'])
  const slopeDiffPos = (s60 != null && s60p != null && (s60 - s60p) > 0)
  if (slopeDiffPos || (accel60 != null && accel60 > 0)) pts += 3

  // Short-term return stack (18pts):
  const r10 = nz(row['10_day_ret'])
  if (r10 != null && r10 > 0) pts += 5 * clamp(r10 / 0.10, 0, 1)

  const r60 = nz(row['60_day_ret'])
  if (r60 != null && r60 > 0) pts += 6 * clamp(r60 / 0.25, 0, 1)

  const r300 = nz(row['300_day_ret'])
  if (r300 != null && r300 > 0) pts += 4 * clamp(r300 / 0.50, 0, 1)

  return clamp(pts, 0, 45)
}

// Volume (max 28)
function scoreVolume(row) {
  let pts = 0

  const z = nz(row['abn_vol_60d'])
  if (z != null) pts += 8 * clamp(z / 2, 0, 1)

  const corr = nz(row['60d_price_dollarVolume_correlation'])
  if (corr != null) pts += 7 * clamp(corr, 0, 1)

  const accel252 = nz(row['252d_dollar_volume_accel'])
  if (accel252 != null && accel252 > 0) pts += 5

  const sma60  = nz(row['60d_dollar_volume_SMA'])
  const sma252 = nz(row['252d_dollar_volume_SMA'])
  if (sma60 != null && sma252 != null && sma252 !== 0) {
    const rel = (sma60 / sma252) - 1
    if (rel > 0) pts += 8 * clamp(rel / 0.20, 0, 1)
  }

  return clamp(pts, 0, 28)
}

// Volatility (max 22)
function scoreVolatility(row) {
  let pts = 0

  const up252 = nz(row['252d_upsidevolatility'])
  const dn252 = nz(row['252d_downsidedeviation'])
  if (up252 != null && dn252 != null && dn252 !== 0 && (up252 / dn252) > 1) pts += 5

  const slope60 = nz(row['slope_over20_of_60d_volatility'])
  if (slope60 != null && slope60 <= 0) pts += 5

  const slope252 = nz(row['slope_over60_of_252d_volatility'])
  if (slope252 != null && slope252 < 0) pts += 4

  const ema15 = nz(row['5d_EMA_15dayvolatility'])
  const vol60 = nz(row['60d_volatility'])
  if (ema15 != null && vol60 != null && vol60 !== 0 && (ema15 / vol60) < 1) pts += 8

  return clamp(pts, 0, 22)
}

// Drawdown (max 5) — favor smaller drawdowns
function scoreDrawdown(row) {
  let pts = 0

  const dd750 = Math.abs(nz(row['750d_drawdown']))
  if (dd750 != null) {
    const frac = clamp(dd750 / 0.40, 0, 1)
    pts += 2 * (1 - frac)
  }

  const dd100 = Math.abs(nz(row['drawdown_percent']))
  if (dd100 != null) {
    const frac = clamp(dd100 / 0.20, 0, 1)
    pts += 3 * (1 - frac)
  }

  return clamp(pts, 0, 5)
}

/* ============================ PAGE ============================ */

export default async function Page() {
  const { latestDt, rowsByTicker, universeCount } = await loadLatestMetricRows()

  // Compose rows & compute scores (apply gatekeepers) — Bullish view
  const all = Array.from(rowsByTicker.entries()).map(([ticker, rowObj]) => {
    const r60   = nz(rowObj['60_day_ret'])
    const pos   = nz(rowObj['5_day_range_pos'])
    const z     = nz(rowObj['abn_vol_60d'])
    const corr  = nz(rowObj['60d_price_dollarVolume_correlation'])
    const ema15 = nz(rowObj['5d_EMA_15dayvolatility'])
    const vol60 = nz(rowObj['60d_volatility'])
    const up252 = nz(rowObj['252d_upsidevolatility'])
    const dn252 = nz(rowObj['252d_downsidedeviation'])
    const dd100 = nz(rowObj['drawdown_percent'])
    const dd750 = nz(rowObj['750d_drawdown'])
    const sma60  = nz(rowObj['60d_dollar_volume_SMA'])
    const sma252 = nz(rowObj['252d_dollar_volume_SMA'])
    const sector = rowObj.gics_sector ?? null

    const gate = passesGatekeepers(rowObj)

    let total = 0
    if (gate) {
      const price = scorePrice(rowObj)
      const vol   = scoreVolume(rowObj)
      const vola  = scoreVolatility(rowObj)
      const dd    = scoreDrawdown(rowObj)
      total = clamp(price + vol + vola + dd, 0, 100)
    }

    return {
      ticker,
      gate,
      __signal_total: total,

      __sector: sector,
      __ret60: r60,
      __pos: pos,
      __abnZ: z,
      __corr: corr,
      __ema15_over_60: (ema15 != null && vol60) ? (vol60 !== 0 ? (ema15 / vol60) : null) : null,
      __up_over_down_252: (up252 != null && dn252) ? (dn252 !== 0 ? (up252 / dn252) : null) : null,
      __dd100: dd100,
      __dd750: dd750,
      __dv60_over_252: (sma60 != null && sma252) ? (sma252 !== 0 ? (sma60 / sma252) : null) : null
    }
  })

  const ultra = all.filter(r => r.gate).sort((a, b) => b.__signal_total - a.__signal_total)

  return (
    <main id="print-area" className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6">
      {/* Inject print handler */}
      <Script id="print-to-pdf">{`
        (function () {
          function ready(fn){ if(document.readyState !== 'loading'){ fn() } else { document.addEventListener('DOMContentLoaded', fn) } }
          ready(function(){
            var btn = document.getElementById('btnPrintPDF');
            if (btn) btn.addEventListener('click', function(){ window.print(); });
          });
        })();
      `}</Script>

      {/* Global print styles WITHOUT styled-jsx */}
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          .no-print { display: none !important; }
          body, html { background: #ffffff !important; }
          #print-area { background: #ffffff !important; }
          .bg-gradient-to-br { background: #ffffff !important; }
          #print-area .max-w-7xl { max-width: 100% !important; }
          table { border-collapse: collapse !important; width: 100% !important; }
          th, td { border: 1px solid #ddd !important; padding: 6px !important; }
          thead { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Activity className="w-7 h-7 text-blue-600" />
              Ultra Bullish, Bearish & Breakout Down
            </h1>
            <button
              id="btnPrintPDF"
              type="button"
              className="no-print inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium bg-gray-800 text-white hover:bg-gray-900 shadow-sm"
              title="Save this page as a PDF"
            >
              Download PDF
            </button>
          </div>
          <p className="text-gray-600 mt-1">
            Latest metric date: <span className="font-medium">{latestDt ?? '—'}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Source: DuckDB (dim_ticker, dim_metric, fact_metric_daily). OBV removed from filters &amp; scoring. 100d drawdown uses <code>drawdown_percent</code>. Universe: {universeCount ?? '—'} tickers.
          </p>
        </div>

        {/* Ultra Bullish table */}
        <UltraBullishSection latestDt={latestDt} universeCount={universeCount} ultraRows={ultra} />

        {/* Bearish table */}
        <BearishSection latestDt={latestDt} rowsByTicker={Array.from(rowsByTicker.entries())} />

        {/* Breakout Down table */}
        <BreakoutDownSection latestDt={latestDt} rowsByTicker={Array.from(rowsByTicker.entries())} />
      </div>
    </main>
  )
}

/* ============================ ULTRA BULLISH SECTION ============================ */

function UltraBullishSection({ latestDt, universeCount, ultraRows }) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Ultra Bullish (Filters + Score 1–100)</h2>
        <div className="text-sm text-gray-500">
          Price: 10d ≥ 2%, 60d ≥ 5% • Volume: abn $vol z &gt; 0.3 OR Price–$Vol corr (60d) &gt; 0.5
        </div>
      </div>

      <p className="text-gray-600 mb-3">
        Latest metric date: <span className="font-medium">{latestDt ?? '—'}</span> • Universe: <span className="font-medium">{universeCount ?? '—'}</span> tickers
      </p>

      {ultraRows.length === 0 ? (
        <div className="text-gray-500 py-8 text-center">No matches with current gatekeepers.</div>
      ) : (
        <TableUltraBullish data={ultraRows} />
      )}
    </section>
  )
}

/* ============================ TABLE (BULLISH) ============================ */

function TableUltraBullish({ data }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Ticker</Th>
            <Th>Signal</Th>
            <Th>60d Ret</Th>
            <Th>Sector</Th>
            <Th>Range Pos (0–1)</Th>
            <Th>Abn $Vol Z</Th>
            <Th>Price–$Vol Corr (60d)</Th>
            <Th>EMA15Vol / 60Vol</Th>
            <Th>Up/Down Vol (252d)</Th>
            <Th>60d$Vol / 252d$Vol</Th>
            <Th>DD (drawdown_percent)</Th>
            <Th>DD 750d</Th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.ticker} className="border-b hover:bg-gray-50">
              <Td className="font-semibold">{r.ticker}</Td>
              <Td className="tabular-nums font-semibold">{num(r.__signal_total, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__ret60, 1)}</Td>
              <Td>{r.__sector ?? '—'}</Td>
              <Td className="tabular-nums">{num(r.__pos, 2)}</Td>
              <Td className="tabular-nums">{num(r.__abnZ, 2)}</Td>
              <Td className="tabular-nums">{num(r.__corr, 2)}</Td>
              <Td className="tabular-nums">{num(r.__ema15_over_60, 3)}</Td>
              <Td className="tabular-nums">{num(r.__up_over_down_252, 2)}</Td>
              <Td className="tabular-nums">{num(r.__dv60_over_252, 2)}</Td>
              <Td className="tabular-nums">{pct(r.__dd100, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__dd750, 1)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============================ SMALL UI HELPERS ============================ */

function Th({ children }) {
  return <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>
}

/* ============================ BEARISH TABLE (server component + helpers) ============================ */

/* --- Gatekeepers (bearish) --- */
function passesGatekeepersBearish(row) {
  const r10  = nz(row['10_day_ret'])
  const r60  = nz(row['60_day_ret'])
  const zAbn = nz(row['abn_vol_60d'])
  const corr = nz(row['60d_price_dollarVolume_correlation'])

  const priceOK = (r10 != null && r10 <= -0.02) && (r60 != null && r60 <= -0.05)
  const volOK   = ((zAbn != null && zAbn > 0.3) || (corr != null && corr > 0.5))
  return priceOK && volOK
}

/* --- Price (max 45) bearish --- */
function scorePriceBearish(row) {
  let pts = 0

  // MA state (12 pts): award when faster MA is below slower MA, up to -10% gap
  const ma20  = nz(row['moving_avg_20d'])
  const ma50  = nz(row['moving_avg_50d'])
  const ma200 = nz(row['moving_avg_200d'])

  // ma20 vs ma50: if ma20 < ma50, up to +6 at -10%
  if (ma20 != null && ma50 != null && ma50 !== 0) {
    const rel = (ma20 / ma50) - 1 // negative when below
    if (rel < 0) pts += 6 * clamp((-rel) / 0.10, 0, 1)
  }

  // ma50 vs ma200: if ma50 < ma200, up to +6 at -10%
  if (ma50 != null && ma200 != null && ma200 !== 0) {
    const rel2 = (ma50 / ma200) - 1
    if (rel2 < 0) pts += 6 * clamp((-rel2) / 0.10, 0, 1)
  }

  // Range / breakout inverse (8 pts): 8 × (1 - pos)
  const pos = clamp(nz(row['5_day_range_pos']) ?? 0, 0, 1)
  pts += 8 * (1 - pos)

  // Return acceleration (7 pts):
  const ch10 = nz(row['change_10dayret'])
  if (ch10 != null && ch10 < 0) pts += 4

  // +3 if slope diff < 0 OR 60d_return_accel < 0
  const s60  = nz(row['slope_over60_of_logprice'])
  const s60p = nz(row['prior_slope_over60_of_logprice'])
  const accel60 = nz(row['60d_return_accel'])
  const slopeDiffNeg = (s60 != null && s60p != null && (s60 - s60p) < 0)
  if (slopeDiffNeg || (accel60 != null && accel60 < 0)) pts += 3

  // Momentum stack (18 pts): award for negative momentum magnitudes
  const r10 = nz(row['10_day_ret'])
  if (r10 != null && r10 < 0) pts += 5 * clamp((-r10) / 0.10, 0, 1)
  const r60 = nz(row['60_day_ret'])
  if (r60 != null && r60 < 0) pts += 6 * clamp((-r60) / 0.25, 0, 1)
  const r300 = nz(row['300_day_ret'])
  if (r300 != null && r300 < 0) pts += 4 * clamp((-r300) / 0.50, 0, 1)

  return clamp(pts, 0, 45)
}

/* --- Volume (max 28) bearish --- */
function scoreVolumeBearish(row) {
  let pts = 0

  const z = nz(row['abn_vol_60d'])
  if (z != null) pts += 8 * clamp(z / 2, 0, 1)

  // prefer NEGATIVE correlation (0→-1 maps to 0→7; positive ⇒ 0)
  const corr = nz(row['60d_price_dollarVolume_correlation'])
  if (corr != null) pts += 7 * clamp(-corr, 0, 1)

  // 252d dollar-volume acceleration: +5 if > 0
  const accel252 = nz(row['252d_dollar_volume_accel'])
  if (accel252 != null && accel252 > 0) pts += 5

  // Liquidity upshift (60d vs 252d $vol)
  const sma60  = nz(row['60d_dollar_volume_SMA'])
  const sma252 = nz(row['252d_dollar_volume_SMA'])
  if (sma60 != null && sma252 != null && sma252 !== 0) {
    const rel = (sma60 / sma252) - 1
    if (rel > 0) pts += 8 * clamp(rel / 0.20, 0, 1)
  }

  return clamp(pts, 0, 28)
}

/* --- Volatility (max 22) bearish --- */
function scoreVolatilityBearish(row) {
  let pts = 0

  // Upside/Downside < 1 → +5
  const up252 = nz(row['252d_upsidevolatility'])
  const dn252 = nz(row['252d_downsidedeviation'])
  if (up252 != null && dn252 != null && dn252 !== 0 && (up252 / dn252) < 1) pts += 5

  // Short-term vol slope ≥ 0 → +5
  const slope60 = nz(row['slope_over20_of_60d_volatility'])
  if (slope60 != null && slope60 >= 0) pts += 5

  // Long-term vol slope > 0 → +4
  const slope252 = nz(row['slope_over60_of_252d_volatility'])
  if (slope252 != null && slope252 > 0) pts += 4

  // Short-over-intermediate vol ratio > 1 → +8
  const ema15 = nz(row['5d_EMA_15dayvolatility'])
  const vol60 = nz(row['60d_volatility'])
  if (ema15 != null && vol60 != null && vol60 !== 0 && (ema15 / vol60) > 1) pts += 8

  return clamp(pts, 0, 22)
}

/* --- Drawdown (max 5) bearish --- */
function scoreDrawdownBearish(row) {
  let pts = 0

  const dd750 = Math.abs(nz(row['750d_drawdown']))
  if (dd750 != null) pts += 2 * clamp(dd750 / 0.40, 0, 1)

  const dd100 = Math.abs(nz(row['drawdown_percent']))
  if (dd100 != null) pts += 3 * clamp(dd100 / 0.20, 0, 1)

  return clamp(pts, 0, 5)
}

/* --- Bearish table UI --- */
function TableBearish({ data }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Ticker</Th>
            <Th>Signal</Th>
            <Th>60d Ret</Th>
            <Th>Sector</Th>
            <Th>Range Pos (0–1)</Th>
            <Th>Abn $Vol Z</Th>
            <Th>Price–$Vol Corr (60d)</Th>
            <Th>EMA15Vol / 60Vol</Th>
            <Th>Up/Down Vol (252d)</Th>
            <Th>60d$Vol / 252d$Vol</Th>
            <Th>DD (drawdown_percent)</Th>
            <Th>DD 750d</Th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.ticker} className="border-b hover:bg-gray-50">
              <Td className="font-semibold">{r.ticker}</Td>
              <Td className="tabular-nums font-semibold">{num(r.__signal_total, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__ret60, 1)}</Td>
              <Td>{r.__sector ?? '—'}</Td>
              <Td className="tabular-nums">{num(r.__pos, 2)}</Td>
              <Td className="tabular-nums">{num(r.__abnZ, 2)}</Td>
              <Td className="tabular-nums">{num(r.__corr, 2)}</Td>
              <Td className="tabular-nums">{num(r.__ema15_over_60, 3)}</Td>
              <Td className="tabular-nums">{num(r.__up_over_down_252, 2)}</Td>
              <Td className="tabular-nums">{num(r.__dv60_over_252, 2)}</Td>
              <Td className="tabular-nums">{pct(r.__dd100, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__dd750, 1)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* --- Server Component to render the Bearish table --- */
export function BearishSection({ latestDt, rowsByTicker }) {
  const all = rowsByTicker.map(([ticker, rowObj]) => {
    const r60   = nz(rowObj['60_day_ret'])
    const pos   = nz(rowObj['5_day_range_pos'])
    const z     = nz(rowObj['abn_vol_60d'])
    const corr  = nz(rowObj['60d_price_dollarVolume_correlation'])
    const ema15 = nz(rowObj['5d_EMA_15dayvolatility'])
    const vol60 = nz(rowObj['60d_volatility'])
    const up252 = nz(rowObj['252d_upsidevolatility'])
    const dn252 = nz(rowObj['252d_downsidedeviation'])
    const dd100 = nz(rowObj['drawdown_percent'])
    const dd750 = nz(rowObj['750d_drawdown'])
    const sma60  = nz(rowObj['60d_dollar_volume_SMA'])
    const sma252 = nz(rowObj['252d_dollar_volume_SMA'])
    const sector = rowObj.gics_sector ?? null

    const gate = passesGatekeepersBearish(rowObj)

    let total = 0
    if (gate) {
      const price = scorePriceBearish(rowObj)
      const vol   = scoreVolumeBearish(rowObj)
      const vola  = scoreVolatilityBearish(rowObj)
      const dd    = scoreDrawdownBearish(rowObj)
      total = clamp(price + vol + vola + dd, 0, 100)
    }

    return {
      ticker,
      gate,
      __signal_total: total,

      __sector: sector,
      __ret60: r60,
      __pos: pos,
      __abnZ: z,
      __corr: corr,
      __ema15_over_60: (ema15 != null && vol60) ? (vol60 !== 0 ? (ema15 / vol60) : null) : null,
      __up_over_down_252: (up252 != null && dn252) ? (dn252 !== 0 ? (up252 / dn252) : null) : null,
      __dd100: dd100,
      __dd750: dd750,
      __dv60_over_252: (sma60 != null && sma252) ? (sma252 !== 0 ? (sma60 / sma252) : null) : null
    }
  })

  const bearish = all
    .filter(r => r.gate)
    .sort((a, b) => b.__signal_total - a.__signal_total)

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Bearish (Filters + Score 1–100)</h2>
        <div className="text-sm text-gray-500">
          Price: 10d ≤ -2%, 60d ≤ -5% • Volume: abn $vol z &gt; 0.3 OR Price–$Vol corr (60d) &gt; 0.5
        </div>
      </div>

      <p className="text-gray-600 mb-3">
        Latest metric date: <span className="font-medium">{latestDt ?? '—'}</span>
      </p>

      {bearish.length === 0 ? (
        <div className="text-gray-500 py-8 text-center">No matches with current bearish gatekeepers.</div>
      ) : (
        <TableBearish data={bearish} />
      )}
    </section>
  )
}

/* ============================ BREAKOUT DOWN (fresh bearish flip) ============================ */

/* --- Gatekeepers (Breakout Down) --- */
function passesGatekeepersBreakdown(row) {
  const r10   = nz(row['10_day_ret'])
  const r60   = nz(row['60_day_ret'])
  const pos5  = nz(row['5_day_range_pos'])
  const ma20  = nz(row['moving_avg_20d'])
  const ma50  = nz(row['moving_avg_50d'])
  const ma200 = nz(row['moving_avg_200d'])

  // Price freshness (flip bearish, not entrenched)
  const priceFresh = (r10 != null && r10 < 0.02) && (r60 != null && r60 > -0.10)

  // Location/Event (must pass)
  const nearLows = (pos5 != null && pos5 <= 0.15)
  const freshTrendFlip =
    (ma20 != null && ma50 != null && ma20 < ma50) ||
    (ma50 != null && ma200 != null && ma50 < ma200)

  // Volume Confirmation (≥1)
  const zAbn = nz(row['abn_vol_60d'])
  const dv60 = nz(row['60d_dollar_volume_SMA'])
  const dv252 = nz(row['252d_dollar_volume_SMA'])
  const liqUpshift = (dv60 != null && dv252 != null && dv252 !== 0) ? ((dv60 / dv252) >= 1.15) : false
  const corr = nz(row['60d_price_dollarVolume_correlation'])
  const volConfirm = (zAbn != null && zAbn >= 0.5) || liqUpshift || (corr != null && corr <= -0.2)

  // Volatility Confirmation (≥1)
  const ema15 = nz(row['5d_EMA_15dayvolatility'])
  const vol60 = nz(row['60d_volatility'])
  const shortVsInter = (ema15 != null && vol60 != null && vol60 !== 0) ? ((ema15 / vol60) > 1) : false
  const slope20of60 = nz(row['slope_over20_of_60d_volatility'])
  const zRange = nz(row['60_10_highlowrange_zscore'])
  const dd100 = nz(row['drawdown_percent']) // Not too deep: using your spec > 0.15 as confirm
  const volaConfirm = shortVsInter || (slope20of60 != null && slope20of60 >= 0) ||
                      (zRange != null && zRange >= 0.25) ||
                      (dd100 != null && dd100 > 0.15)

  return priceFresh && nearLows && freshTrendFlip && volConfirm && volaConfirm
}

/* --- Price (≤ 40 pts) --- */
function scorePriceBreakdown(row) {
  let pts = 0

  // MA alignment (12 pts: up to +6 each when faster MA is up to 5% below slower)
  const ma20  = nz(row['moving_avg_20d'])
  const ma50  = nz(row['moving_avg_50d'])
  const ma200 = nz(row['moving_avg_200d'])
  if (ma20 != null && ma50 != null && ma50 !== 0) {
    const rel = (ma20 / ma50) - 1 // negative means below
    if (rel < 0) pts += 6 * clamp((-rel) / 0.05, 0, 1)
  }
  if (ma50 != null && ma200 != null && ma200 !== 0) {
    const rel2 = (ma50 / ma200) - 1
    if (rel2 < 0) pts += 6 * clamp((-rel2) / 0.05, 0, 1)
  }

  // Slope delta (10 pts) — delta in [0, -0.02] → [0, 10]; ≤ -0.02 gets full 10; >0 gets 0
  const s60  = nz(row['slope_over60_of_logprice'])
  const s60p = nz(row['prior_slope_over60_of_logprice'])
  if (s60 != null && s60p != null) {
    const delta = s60 - s60p
    if (delta <= 0) pts += 10 * clamp((-delta) / 0.02, 0, 1)
  }

  // Return profile (10 pts)
  const r10 = nz(row['10_day_ret'])
  if (r10 != null && r10 < -0.02) pts += 5
  const r60 = nz(row['60_day_ret'])
  if (r60 != null) {
    if (r60 > 0) pts += 5
    else if (r60 >= -0.10) pts += 2
  }

  // 200-day regime bias (8 pts)
  const r200 = nz(row['200_day_ret'])
  if (r200 != null) pts += (r200 > 0) ? 8 : 3

  return clamp(pts, 0, 40)
}

/* --- Volume (≤ 25 pts) --- */
function scoreVolumeBreakdown(row) {
  let pts = 0
  const z = nz(row['abn_vol_60d'])
  if (z != null) pts += 10 * clamp(z / 1.85, 0, 1)

  const dv60  = nz(row['60d_dollar_volume_SMA'])
  const dv252 = nz(row['252d_dollar_volume_SMA'])
  if (dv60 != null && dv252 != null && dv252 !== 0) {
    const rel = (dv60 / dv252) - 1
    pts += 8 * clamp(rel / 0.20, 0, 1)
  }

  const corr = nz(row['60d_price_dollarVolume_correlation'])
  if (corr != null) pts += 7 * clamp(-corr, 0, 1) // more negative → more points

  return clamp(pts, 0, 25)
}

/* --- Volatility (≤ 25 pts) --- */
function scoreVolatilityBreakdown(row) {
  let pts = 0
  const ema15 = nz(row['5d_EMA_15dayvolatility'])
  const vol60 = nz(row['60d_volatility'])
  if (ema15 != null && vol60 != null && vol60 !== 0) {
    const ratio = ema15 / vol60
    if (ratio > 1) pts += 10 * clamp((ratio - 1) / 0.50, 0, 1) // full @ 1.5x
  }

  const slope20of60 = nz(row['slope_over20_of_60d_volatility'])
  if (slope20of60 != null && slope20of60 >= 0) {
    pts += 8 * clamp(slope20of60 / 0.02, 0, 1)
  }

  const zRange = nz(row['60_10_highlowrange_zscore'])
  if (zRange != null) {
    pts += 7 * clamp(zRange / 1.8, 0, 1) // 0→1.8 maps to 0→7; >1.8 clamps
  }

  return clamp(pts, 0, 25)
}

/* --- Drawdown Context (≤ 10 pts) --- */
function scoreDrawdownBreakdown(row) {
  let pts = 0
  const dd = Math.abs(nz(row['drawdown_percent'])) // assume fraction (e.g., 0.12 = 12%)
  if (dd != null) {
    // 6 pts: more points when drawdown is less; dd in [0,0.20] → [6,0]
    if (dd <= 0.20) pts += 6 * (1 - clamp(dd / 0.20, 0, 1))
  }
  const dd750 = Math.abs(nz(row['750d_drawdown']))
  if (dd750 != null) {
    // 4 pts: dd750 in [0,0.40] → [4,0]
    pts += 4 * (1 - clamp(dd750 / 0.40, 0, 1))
  }
  return clamp(pts, 0, 10)
}

/* --- Table UI --- */
function TableBreakoutDown({ data }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Ticker</Th>
            <Th>Signal</Th>
            <Th>10d Ret</Th>
            <Th>60d Ret</Th>
            <Th>Sector</Th>
            <Th>5d Range Pos</Th>
            <Th>MA20&lt;50 / 50&lt;200</Th>
            <Th>Abn $Vol Z</Th>
            <Th>$Vol 60/252</Th>
            <Th>Price–$Vol Corr (60d)</Th>
            <Th>EMA15Vol/60Vol</Th>
            <Th>VolSlope20→60</Th>
            <Th>60↔10 Range Z</Th>
            <Th>Drawdown (100d)</Th>
            <Th>Drawdown 750d</Th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.ticker} className="border-b hover:bg-gray-50">
              <Td className="font-semibold">{r.ticker}</Td>
              <Td className="tabular-nums font-semibold">{num(r.__signal_total, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__ret10, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__ret60, 1)}</Td>
              <Td>{r.__sector ?? '—'}</Td>
              <Td className="tabular-nums">{num(r.__pos5, 2)}</Td>
              <Td className="tabular-nums">
                {r.__ma20lt50 ? '20<50' : ''}{r.__ma50lt200 ? (r.__ma20lt50 ? ' · ' : '') + '50<200' : (!r.__ma20lt50 && !r.__ma50lt200 ? '—' : '')}
              </Td>
              <Td className="tabular-nums">{num(r.__abnZ, 2)}</Td>
              <Td className="tabular-nums">{num(r.__dv60_over_252, 2)}</Td>
              <Td className="tabular-nums">{num(r.__corr, 2)}</Td>
              <Td className="tabular-nums">{num(r.__ema15_over_60, 3)}</Td>
              <Td className="tabular-nums">{num(r.__slope20of60, 3)}</Td>
              <Td className="tabular-nums">{num(r.__zRange, 2)}</Td>
              <Td className="tabular-nums">{pct(r.__dd100, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__dd750, 1)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* --- Server Component: Breakout Down Section --- */
export function BreakoutDownSection({ latestDt, rowsByTicker }) {
  const all = rowsByTicker.map(([ticker, rowObj]) => {
    const r10   = nz(rowObj['10_day_ret'])
    const r60   = nz(rowObj['60_day_ret'])
    const pos5  = nz(rowObj['5_day_range_pos'])
    const ma20  = nz(rowObj['moving_avg_20d'])
    const ma50  = nz(rowObj['moving_avg_50d'])
    const ma200 = nz(rowObj['moving_avg_200d'])
    const z     = nz(rowObj['abn_vol_60d'])
    const corr  = nz(rowObj['60d_price_dollarVolume_correlation'])
    const ema15 = nz(rowObj['5d_EMA_15dayvolatility'])
    const vol60 = nz(rowObj['60d_volatility'])
    const slope20of60 = nz(rowObj['slope_over20_of_60d_volatility'])
    const zRange = nz(rowObj['60_10_highlowrange_zscore'])
    const dd100 = nz(rowObj['drawdown_percent'])
    const dd750 = nz(rowObj['750d_drawdown'])
    const dv60  = nz(rowObj['60d_dollar_volume_SMA'])
    const dv252 = nz(rowObj['252d_dollar_volume_SMA'])
    const sector = rowObj.gics_sector ?? null

    const gate = passesGatekeepersBreakdown(rowObj)

    let total = 0
    if (gate) {
      const price = scorePriceBreakdown(rowObj)     // ≤ 40
      const vol   = scoreVolumeBreakdown(rowObj)    // ≤ 25
      const vola  = scoreVolatilityBreakdown(rowObj)// ≤ 25
      const dd    = scoreDrawdownBreakdown(rowObj)  // ≤ 10
      total = clamp(price + vol + vola + dd, 0, 100)
    }

    return {
      ticker,
      gate,
      __signal_total: total,

      __sector: sector,
      __ret10: r10,
      __ret60: r60,
      __pos5: pos5,
      __ma20lt50: (ma20 != null && ma50 != null) ? (ma20 < ma50) : null,
      __ma50lt200: (ma50 != null && ma200 != null) ? (ma50 < ma200) : null,
      __abnZ: z,
      __corr: corr,
      __ema15_over_60: (ema15 != null && vol60) ? (vol60 !== 0 ? (ema15 / vol60) : null) : null,
      __slope20of60: slope20of60,
      __zRange: zRange,
      __dd100: dd100,
      __dd750: dd750,
      __dv60_over_252: (dv60 != null && dv252) ? (dv252 !== 0 ? (dv60 / dv252) : null) : null
    }
  })

  const breakdown = all
    .filter(r => r.gate)
    .sort((a, b) => b.__signal_total - a.__signal_total)

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Breakout Down (Fresh Bearish Flip)</h2>
        <div className="text-sm text-gray-500">
          Price: 10d &lt; 2%, 60d &gt; −10% • Location: pos≤0.15 + (20&lt;50 or 50&lt;200) •
          Volume: z≥0.5 or 60/252≥1.15 or corr≤−0.2 •
          Volatility: ratio&gt;1 or slope≥0 or z≥0.25 or dd&gt;15%
        </div>
      </div>

      <p className="text-gray-600 mb-3">
        Latest metric date: <span className="font-medium">{latestDt ?? '—'}</span>
      </p>

      {breakdown.length === 0 ? (
        <div className="text-gray-500 py-8 text-center">No names meeting Breakout Down gatekeepers today.</div>
      ) : (
        <TableBreakoutDown data={breakdown} />
      )}
    </section>
  )
}
