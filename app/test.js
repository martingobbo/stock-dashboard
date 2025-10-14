'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Filter, ArrowUpRight, AlertTriangle, Activity } from 'lucide-react'

/* ----------------------------- helpers ----------------------------- */
const pct = (x, dp = 2) => (x == null || isNaN(x)) ? 'N/A' : `${(Number(x) * 100).toFixed(dp)}%`
const num = (x, dp = 2) => (x == null || isNaN(parseFloat(x))) ? 'N/A' : parseFloat(x).toFixed(dp)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// pick first non-null field; auto-parse strings to numbers
const pick = (row, ...names) => {
  for (const n of names) {
    if (row == null) continue
    const raw = row[n]
    if (raw == null || raw === '') continue
    const v = typeof raw === 'string' ? parseFloat(raw) : raw
    if (!Number.isNaN(v)) return v
  }
  return null
}

// CSV loader (expects simple, no-quoted commas). File must live in /public/data/
async function loadMetricsCSV() {
  const res = await fetch('/data/stock_analysis_metrics.csv', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to fetch stock_analysis_metrics.csv: ${res.status}`)
  const text = await res.text()
  const lines = text.trim().split(/\r?\n/)
  if (!lines.length) return []
  const header = lines[0]
  const cols = header.split(',')
  return lines.slice(1).map(l => {
    const vals = l.split(',')
    const obj = {}
    cols.forEach((c, i) => { obj[c] = vals[i] })
    return obj
  })
}

// build latest-by-ticker map from an array of {date, ticker, ...}
function latestRowsByTicker(rows) {
  const m = new Map()
  for (const r of rows) {
    const k = r.ticker
    if (!k) continue
    const cur = m.get(k)
    if (!cur || new Date(r.date) > new Date(cur.date)) m.set(k, r)
  }
  return m
}

/** Row schema after merge (key fields we use):
 * ticker, date, close,
 * moving_avg_20d, moving_avg_50d, moving_avg_200d,
 * 10_day_ret, 60_day_ret, 200_day_ret, 300_day_ret,
 * 5_day_range_pos,
 * change_10dayret, slope_over60_of_logprice,
 * 15d_volatility, 60d_volatility, 252d_volatility,
 * slope_over20_of_60d_volatility, slope_over60_of_252d_volatility,
 * 60d_downsidedeviation, 60d_upsidevolatility,
 * 10d_OBV_slope, 252d_dollar_volume_accel,
 * 60d_price_dollarVolume_correlation,
 * 750d_drawdown
 */

export default function Screener() {
  /* ----------------------------- universe ----------------------------- */
  const TICKERS = [
    'AAPL','MSFT','GOOGL','AMZN','TSLA','META','NVDA','IWM','IVT','VTV','VUG','MTUM','SPY','QUAL','AVGO','BRK.B','JPM','WMT','LLY','V','ORCL','MA','NFLX','XOM','JNJ','COST','HD','BAC','PG','ABBV','CVX','KO','GE','TMUS','UNH','AMD','CSCO','WFC','PM','CRM','MS','ABT','GS','IBM','LIN','AXP','MCD','RTX','DIS','MRK','T','BX','CAT','PEP','UBER','VZ','TMO','BKNG','BA','ISRG','BSX','AMGN','ENPH','AKAM','TJX','EPAM','NEE','SWKS','LOW','ZBRA','HON','FFIV','ETN','UNP','DE','CMCSA','COP','NKE','WELL','MO','PLD','SO','SBUX','RCL','AMT','DUK','SHW','MDLZ','ECL','NEM','WMB','CL','EOG','VST','APD','FCX','AEP','MNST','KMI','SPG','DLR','SLB','MPC','PSX','O','PSA','D'
  ]

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])        // merged latest per ticker (supabase + CSV)
  const [latestDate, setLatestDate] = useState(null)

  // knobs (for the other tables; Ultra Bullish ignores these)
  const [volMinZ, setVolMinZ]               = useState(0.0)
  const [mrMaxNormRange, setMrMaxNormRange] = useState(0.40)
  const [mrMinDrawdown, setMrMinDrawdown]   = useState(-0.07)

  /* ----------------------------- data load & merge ----------------------------- */
  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        // 1) latest market date
        const { data: latestRow, error: latestErr } = await supabase
          .from('stock_prices')
          .select('date')
          .order('date', { ascending: false })
          .limit(1)
          .single()
        if (latestErr) throw latestErr
        const mktDate = latestRow?.date
        setLatestDate(mktDate)

        // 2) latest closes at that date
        const { data: pxRows, error: pxErr } = await supabase
          .from('stock_prices')
          .select('ticker, close_price')
          .eq('date', mktDate)
          .in('ticker', TICKERS)
        if (pxErr) throw pxErr
        const closeMap = new Map((pxRows || []).map(r => [r.ticker, parseFloat(r.close_price)]))

        // 3) stock_analysis at that date (fallback to latest per ticker)
        let { data: anaRows, error: anaErr } = await supabase
          .from('stock_analysis')
          .select('*')
          .eq('date', mktDate)
          .in('ticker', TICKERS)
        if (anaErr) throw anaErr

        // if missing tickers, fallback to latest rows per ticker
        const have = new Set((anaRows || []).map(r => r.ticker))
        const missing = TICKERS.filter(t => !have.has(t))
        if (missing.length > 0) {
          const { data: fb, error: fbErr } = await supabase
            .from('stock_analysis')
            .select('*')
            .in('ticker', missing)
            .order('date', { ascending: false })
            .limit(2000)
          if (fbErr) throw fbErr
          const latestPer = Array.from(latestRowsByTicker(fb).values())
          anaRows = [...(anaRows || []), ...latestPer]
        }

        // 4) load metrics CSV and filter to market date (with fallback to latest per ticker)
        const metricsAll = await loadMetricsCSV()
        let metricsUse = metricsAll.filter(m => m.date === mktDate)
        if (metricsUse.length === 0) {
          // fallback: latest metrics per ticker
          metricsUse = Array.from(latestRowsByTicker(metricsAll).values())
        }
        const metricsByTicker = new Map(metricsUse.map(m => [m.ticker, m]))

        // 5) merge supabase analysis + metrics CSV + close (latest per ticker)
        const merged = (anaRows || []).map(r => {
          const m = metricsByTicker.get(r.ticker) || {}
          return {
            ...r,
            ...m,                 // CSV fields (strings) — we’ll parse on read
            close: closeMap.get(r.ticker) ?? null
          }
        })

        // 6) keep only latest per ticker (by date present on the row)
        const latestMap = latestRowsByTicker(merged)
        setRows(Array.from(latestMap.values()).sort((a, b) => a.ticker.localeCompare(b.ticker)))
      } catch (e) {
        console.error('Screener load error:', e)
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ----------------------------- scoring (Ultra Bullish) ----------------------------- */

  // Price (50)
  function scorePrice(row) {
    let pts = 0

    // MA state (15)
    const c    = pick(row, 'close')
    const ma20 = pick(row, 'moving_avg_20d')
    const ma50 = pick(row, 'moving_avg_50d')
    const ma200= pick(row, 'moving_avg_200d')
    if (ma20 != null && ma50 != null && c != null && ma20 > ma50) pts += 7
    if (ma50 != null && ma200 != null && ma50 > ma200) pts += 8

    // Range / breakout (10): 10 * posInRange (cap 10)
    const pos = pick(row, '5_day_range_pos', 'basicStats.posInRange')
    if (pos != null) pts += clamp(pos * 10, 0, 10)

    // Return acceleration (10)
    const ch10 = pick(row, 'change_10dayret')
    const slopeLog60 = pick(row, 'slope_over60_of_logprice')
    if (ch10 != null && ch10 > 0) pts += 5
    if (slopeLog60 != null && slopeLog60 > 0) pts += 5

    // Intermediate trend (10): map 60d ret (0%→0 … 10%→10)
    const r60 = pick(row, '60_day_ret', 'ret_60d')
    if (r60 != null) pts += clamp(r60 * 100, 0, 10)

    // Longer support (5)
    const r300 = pick(row, '300_day_ret', 'ret_300d')
    if (r300 != null && r300 > 0) pts += 5

    return clamp(pts, 0, 50)
  }

  // Volume (30)
  function scoreVolume(row) {
    let pts = 0

    // Abnormal $ vol (10) — if you have abn_vol_60d in stock_analysis, this will count
    const z = pick(row, 'abn_vol_60d', 'abn_dollar_vol_60d')
    if (z != null) {
      if (z >= 1.3) pts += 10
      else if (z >= 0.8) pts += 6
      else if (z >= 0.0) pts += 3
    }

    // Turnover trend (10): accel + OBV slope
    const accel252 = pick(row, '252d_dollar_volume_accel')
    if (accel252 != null && accel252 > 0) pts += 6

    const obvSlope = pick(row, '10d_OBV_slope')
    if (obvSlope != null) {
      let obvPts = 0
      if (obvSlope > 0) {
        const scaled = Math.min(1, obvSlope / (Math.abs(obvSlope) + 0.2))
        obvPts = clamp(4 * scaled, 0, 4)
      }
      pts += obvPts
    }

    // Price–$vol corr (10)
    const corr = pick(row, '60d_price_dollarVolume_correlation')
    if (corr != null) {
      if (corr >= 0.5) pts += 10
      else if (corr >= 0.3) pts += 7
      else if (corr >= 0.0) pts += 4
    }

    return clamp(pts, 0, 30)
  }

  // Volatility (15)
  function scoreVolatility(row) {
    let pts = 0
    const v15 = pick(row, '15d_volatility')
    const v60 = pick(row, '60d_volatility')
    const slope60  = pick(row, 'slope_over20_of_60d_volatility')
    const slope252 = pick(row, 'slope_over60_of_252d_volatility')
    const up60 = pick(row, '60d_upsidevolatility')
    const dn60 = pick(row, '60d_downsidedeviation')

    // Cooling / controlled (<= 0 slope; 15/60 < 1)
    if (slope60 != null && slope60 <= 0) pts += 2.5
    if (v15 != null && v60 != null && v60 !== 0 && v15 / v60 < 1) pts += 6

    if (slope60 != null)  pts += 2
    if (slope252 != null) pts += 2
    if (up60 != null && dn60 != null && dn60 !== 0 && up60 / dn60 > 1) pts += 2.5

    return clamp(pts, 0, 15)
  }

  // Drawdown (5)
  function scoreDrawdown(row) {
    let pts = 0
    const dd100 = pick(row, '100d_drawdown', '100d_max_drawdown', 'drawdown_100d') // if present
    const dd750 = pick(row, '750d_drawdown')

    if (dd100 != null && dd100 > -0.15) pts += 2.5
    if (dd750 != null && dd750 > -0.40) pts += 2.5
    return clamp(pts, 0, 5)
  }

  // Gatekeepers (filters)
  function passesFilters(row) {
    const r10 = pick(row, '10_day_ret', 'ret_10d')
    const r60 = pick(row, '60_day_ret', 'ret_60d')
    const priceOK = (r10 != null && r10 >= 0.02) && (r60 != null && r60 >= 0.05)

    // at least one of:
    const abn = pick(row, 'abn_vol_60d', 'abn_dollar_vol_60d')
    const obv = pick(row, '10d_OBV_slope')
    const accel252 = pick(row, '252d_dollar_volume_accel')
    const volOK = ((abn != null && abn > 0) || (obv != null && obv > 0) || (accel252 != null && accel252 > 0))

    return priceOK && volOK
  }

  const ultraBullishScored = useMemo(() => {
    return rows
      .filter(passesFilters)
      .map(r => {
        const pricePts = scorePrice(r)
        const volPts   = scoreVolume(r)
        const volaPts  = scoreVolatility(r)
        const ddPts    = scoreDrawdown(r)
        const total    = clamp(pricePts + volPts + volaPts + ddPts, 0, 100)

        const posRange = pick(r, '5_day_range_pos', 'basicStats.posInRange')
        const z        = pick(r, 'abn_vol_60d', 'abn_dollar_vol_60d') // may be null if not tracked
        const obv      = pick(r, '10d_OBV_slope')
        const corr     = pick(r, '60d_price_dollarVolume_correlation')
        const v15      = pick(r, '15d_volatility')
        const v60      = pick(r, '60d_volatility')
        const slope60  = pick(r, 'slope_over20_of_60d_volatility')
        const slope252 = pick(r, 'slope_over60_of_252d_volatility')
        const up60     = pick(r, '60d_upsidevolatility')
        const dn60     = pick(r, '60d_downsidedeviation')
        const dd100    = pick(r, '100d_drawdown', '100d_max_drawdown', 'drawdown_100d')
        const dd750    = pick(r, '750d_drawdown')
        const r60      = pick(r, '60_day_ret', 'ret_60d')

        return {
          ...r,
          __signal_total: total,
          __signal_breakout_pos: posRange,
          __signal_abnZ: z,
          __signal_obvSlope: obv,
          __signal_corrPriceDollarVol: corr,
          __signal_volRatio15over60: (v15 != null && v60 && v60 !== 0) ? (v15 / v60) : null,
          __signal_slope60: slope60,
          __signal_slope252: slope252,
          __signal_udRatio60: (up60 != null && dn60 && dn60 !== 0) ? (up60 / dn60) : null,
          __dd100: dd100,
          __dd750: dd750,
          __ret60: r60
        }
      })
      .sort((a, b) => b.__signal_total - a.__signal_total)
  }, [rows])

  /* ----------------------------- other derived tables (unchanged) ----------------------------- */

  const volatileOpp = useMemo(() => {
    return rows.filter(r => {
      const z = r['60_10_highlowrange_zscore'] != null ? parseFloat(r['60_10_highlowrange_zscore']) : null
      const v20 = r.volatility_20d != null ? parseFloat(r.volatility_20d) : null
      const v100 = r.volatility_100d != null ? parseFloat(r.volatility_100d) : null
      return (z != null && z > volMinZ) && (v20 != null && v100 != null && v20 > v100)
    })
  }, [rows, volMinZ])

  const meanReversion = useMemo(() => {
    return rows.filter(r => {
      const norm = r['5_day_range_pos'] != null ? parseFloat(r['5_day_range_pos']) : null
      const z    = r['60_10_highlowrange_zscore'] != null ? parseFloat(r['60_10_highlowrange_zscore']) : null
      const dd   = r.drawdown_percent != null ? parseFloat(r.drawdown_percent) : null
      const ltBull = r.long_term_momentum === 'bullish'
      return (norm != null && norm < mrMaxNormRange) &&
             (z != null && z < -0.15) &&
             (dd != null && dd <= mrMinDrawdown) &&
             ltBull
    })
  }, [rows, mrMaxNormRange, mrMinDrawdown])

  const signalSnapshot = useMemo(() => rows, [rows])

  /* ----------------------------- UI ----------------------------- */
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse text-gray-600">Loading Screener…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto space-y-10">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Activity className="w-7 h-7 text-blue-600" />
            Multi-Signal Screener
          </h1>
          <p className="text-gray-600 mt-1">
            Latest date: <span className="font-medium">{latestDate || '—'}</span> • Universe size: <span className="font-medium">{rows.length}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Universe is hard-coded. Edit the list where it says <strong>PUT TICKERS HERE</strong>.
          </p>
        </div>

        {/* Ultra Bullish */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Ultra Bullish (Filters + Scored 1–100)</h2>
            <div className="text-sm text-gray-500">
              Price: 10d ≥ 2%, 60d ≥ 5% • Volume: abn $vol &gt; 0 OR 10d OBV slope &gt; 0 OR 252d $vol accel &gt; 0
            </div>
          </div>

          {ultraBullishScored.length === 0 ? (
            <div className="text-gray-500 py-8 text-center">No matches with current gatekeepers.</div>
          ) : (
            <TableUltraBullish data={ultraBullishScored} />
          )}
        </section>

        {/* Volatile Opportunity (unchanged) */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Volatile Opportunity</h2>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-blue-600" />
                <span>Min Range Z (&gt;):</span>
                <input
                  type="number"
                  step="0.1"
                  value={volMinZ}
                  onChange={e=>setVolMinZ(parseFloat(e.target.value))}
                  className="w-20 px-2 py-1 border rounded"
                />
              </div>
              <span className="text-gray-500">Requires Vol20 &gt; Vol100 as well.</span>
            </div>
          </div>

          {volatileOpp.length === 0 ? (
            <div className="text-gray-500 py-8 text-center">No matches with current filters.</div>
          ) : (
            <TableVolatile data={volatileOpp} />
          )}
        </section>

        {/* Mean-Reversion Setup (unchanged) */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Mean-Reversion Setup</h2>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-blue-600" />
                <span>Max 3d Norm Range:</span>
                <input
                  type="number"
                  step="0.05" min="0" max="1"
                  value={mrMaxNormRange}
                  onChange={e=>setMrMaxNormRange(parseFloat(e.target.value))}
                  className="w-20 px-2 py-1 border rounded"
                />
              </div>
              <div className="flex items-center gap-2">
                <span>Drawdown ≤</span>
                <input
                  type="number"
                  step="0.01"
                  value={mrMinDrawdown}
                  onChange={e=>setMrMinDrawdown(parseFloat(e.target.value))}
                  className="w-24 px-2 py-1 border rounded"
                />
                <span className="text-gray-500">(-0.07 = -7%, Compression requires Z &lt; -0.15)</span>
              </div>
            </div>
          </div>

          {meanReversion.length === 0 ? (
            <div className="text-gray-500 py-8 text-center">No matches with current filters.</div>
          ) : (
            <TableMeanReversion data={meanReversion} />
          )}
        </section>

        {/* SIGNAL SNAPSHOT */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Signal Snapshot (All Tickers)</h2>
            <p className="text-sm text-gray-600">
              Quick view of VWAP and short-range position.
            </p>
          </div>

          {signalSnapshot.length === 0 ? (
            <div className="text-gray-500 py-8 text-center">No rows found — check your ticker list or data load.</div>
          ) : (
            <TableSignalSnapshot data={signalSnapshot} />
          )}
        </section>

        <div className="text-xs text-gray-500 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>All conditions computed from the latest available row per ticker; if analysis is missing on the latest price date, the most recent analysis row is used.</span>
        </div>
      </div>
    </div>
  )
}

/* ----------------------------- tables ----------------------------- */
function TableUltraBullish({ data }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Ticker</Th>
            <Th>Signal</Th>
            <Th>60d Ret</Th>
            <Th>Range Pos (0–1)</Th>
            <Th>Abn $Vol Z</Th>
            <Th>10d OBV Slope</Th>
            <Th>Price–$Vol Corr (60d)</Th>
            <Th>Vol 15/60</Th>
            <Th>Slope 60d Vol</Th>
            <Th>Slope 252d Vol</Th>
            <Th>Up/Down Vol (60d)</Th>
            <Th>DD 100d</Th>
            <Th>DD 750d</Th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.ticker} className="border-b hover:bg-gray-50">
              <Td className="font-semibold">{r.ticker}</Td>
              <Td className="tabular-nums font-semibold">{num(r.__signal_total, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__ret60, 1)}</Td>
              <Td className="tabular-nums">{num(r.__signal_breakout_pos, 2)}</Td>
              <Td className="tabular-nums">{num(r.__signal_abnZ, 2)}</Td>
              <Td className="tabular-nums">{num(r.__signal_obvSlope, 3)}</Td>
              <Td className="tabular-nums">{num(r.__signal_corrPriceDollarVol, 2)}</Td>
              <Td className="tabular-nums">{num(r.__signal_volRatio15over60, 3)}</Td>
              <Td className="tabular-nums">{num(r.__signal_slope60, 3)}</Td>
              <Td className="tabular-nums">{num(r.__signal_slope252, 3)}</Td>
              <Td className="tabular-nums">{num(r.__signal_udRatio60, 2)}</Td>
              <Td className="tabular-nums">{pct(r.__dd100, 1)}</Td>
              <Td className="tabular-nums">{pct(r.__dd750, 1)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableVolatile({ data }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Ticker</Th>
            <Th>Range Z</Th>
            <Th>Vol 20d</Th>
            <Th>Vol 100d</Th>
            <Th>5d Ret</Th>
            <Th>20d Ret</Th>
            <Th>60d Ret</Th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.ticker} className="border-b hover:bg-gray-50">
              <Td className="font-semibold">{r.ticker}</Td>
              <Td className="tabular-nums">{num(r['60_10_highlowrange_zscore'],2)}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r.volatility_20d),2)}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r.volatility_100d),2)}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r['5_day_ret']),2)}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r['20_day_ret']),2)}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r['60_day_ret']),2)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableMeanReversion({ data }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Ticker</Th>
            <Th>3d Norm Range</Th>
            <Th>Range Z</Th>
            <Th>Drawdown %</Th>
            <Th>LT Momentum</Th>
            <Th>10d Ret</Th>
            <Th>20d Ret</Th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => (
            <tr key={r.ticker} className="border-b hover:bg-gray-50">
              <Td className="font-semibold">{r.ticker}</Td>
              <Td className="tabular-nums">{num(r['5_day_range_pos'],2)}</Td>
              <Td className="tabular-nums">{num(r['60_10_highlowrange_zscore'],2)}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r.drawdown_percent) ?? 0,2)}</Td>
              <Td>{r.long_term_momentum || '—'}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r['10_day_ret']),2)}</Td>
              <Td className="tabular-nums">{pct(parseFloat(r['20_day_ret']),2)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableSignalSnapshot({ data }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <Th>Ticker</Th>
            <Th>Close</Th>
            <Th>VWAP20</Th>
            <Th>Above VWAP?</Th>
            <Th>3d Norm Range</Th>
            <Th>Vol Accel 5d (lnΔ)</Th>
            <Th>Vol Accel 10d (lnΔ)</Th>
          </tr>
        </thead>
        <tbody>
          {data.map(r => {
            const c = r.close
            const vwap = r.vwap_20d != null ? parseFloat(r.vwap_20d) : null
            const above = c != null && vwap != null && c > vwap
            return (
              <tr key={r.ticker} className="border-b hover:bg-gray-50">
                <Td className="font-semibold">{r.ticker}</Td>
                <Td className="tabular-nums">${num(c,2)}</Td>
                <Td className="tabular-nums">${num(vwap,2)}</Td>
                <Td><MiniBadge ok={above}>{above ? 'Yes' : 'No'}</MiniBadge></Td>
                <Td className="tabular-nums">{num(r['5_day_range_pos'],3)}</Td>
                <Td className="tabular-nums">{num(r.vol_accel_5d,3)}</Td>
                <Td className="tabular-nums">{num(r.vol_accel_10d,3)}</Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ----------------------------- tiny UI helpers ----------------------------- */
function Th({ children }) {
  return <th className="px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap">{children}</th>
}
function Td({ children, className = '' }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>
}
function MiniBadge({ ok, children }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-1
      ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
      {children}{ok ? <ArrowUpRight className="w-3 h-3 ml-1" /> : null}
    </span>
  )
}
