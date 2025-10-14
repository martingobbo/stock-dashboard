'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Bar, ReferenceLine
} from 'recharts'
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Activity, Target,
  AlertCircle, Clock, Volume2, Building2, Info, Layers
} from 'lucide-react'

/* ----------------------------- CSV helpers (public/) ----------------------------- */
// Auto-detect comma vs tab
function detectDelimiter(headerLine) {
  const c = (headerLine.match(/,/g) || []).length
  const t = (headerLine.match(/\t/g) || []).length
  return t > c ? '\t' : ','
}
// Minimal CSV/TSV parser (no quoted commas)
function parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '').trim()
  const lines = clean.split(/\r?\n/)
  if (!lines.length) return []
  const delim = detectDelimiter(lines[0])
  const headers = lines[0].split(delim).map(h => h.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const cells = line.split(delim)
    const obj = {}
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j]
      const raw = (cells[j] ?? '').trim()
      // try number, else keep raw string
      const num = Number(raw)
      obj[key] = raw !== '' && Number.isFinite(num) ? num : raw
    }
    rows.push(obj)
  }
  return rows
}

async function loadCSV(path) {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`)
  const txt = await res.text()
  return parseCSV(txt)
}

/* ----------------------------- UI Helper Cards ---------------------------- */
const StatCard = ({ title, value, change, icon: Icon, positive, children }) => (
  <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-600 mb-1 truncate">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {change && (
          <p className={`text-sm font-medium ${positive ? 'text-green-600' : 'text-red-600'} flex items-center mt-1`}>
            {positive ? <TrendingUp className="w-4 h-4 mr-1" /> : <TrendingDown className="w-4 h-4 mr-1" />}
            {change}
          </p>
        )}
        {children && <div className="mt-3">{children}</div>}
      </div>
      <div className={`p-3 rounded-lg ${positive === null ? 'bg-blue-50' : positive ? 'bg-green-50' : 'bg-red-50'}`}>
        <Icon className={`w-6 h-6 ${positive === null ? 'text-blue-600' : positive ? 'text-green-600' : 'text-red-600'}`} />
      </div>
    </div>
  </div>
)

const ProgressBar = ({ value, max, color = 'blue' }) => {
  const percentage = Math.max(0, Math.min((value / max) * 100, 100))
  const colorClasses = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
    yellow: 'bg-yellow-500'
  }
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div className={`h-2 rounded-full ${colorClasses[color]} transition-all duration-300`} style={{ width: `${percentage}%` }} />
    </div>
  )
}

const VolAccelBadge = ({ label, value }) => {
  const num = value == null ? null : parseFloat(value)
  const isUp = num != null && num > 0
  const color = num == null ? 'bg-gray-100 text-gray-700' : isUp ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
  return (
    <div className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-medium ${color}`}>
      <Volume2 className="w-3 h-3 mr-1" />
      {label && <span className="mr-1">{label}</span>}
      <span className="font-semibold">{num == null ? 'N/A' : num.toFixed(3)}</span>
      {num != null && (isUp ? <TrendingUp className="w-3 h-3 ml-1" /> : <TrendingDown className="w-3 h-3 ml-1" />)}
    </div>
  )
}
const AbnVolBadge = ({ z }) => {
  const num = z == null ? null : parseFloat(z)
  let style = 'bg-gray-100 text-gray-700'
  if (num != null) {
    if (num >= 2) style = 'bg-green-100 text-green-800'
    else if (num <= -2) style = 'bg-red-100 text-red-800'
    else style = 'bg-amber-100 text-amber-800'
  }
  return (
    <div className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-medium ${style}`}>
      <Volume2 className="w-3 h-3 mr-1" />
      <span className="mr-1">Abn Vol 60d (z)</span>
      <span className="font-semibold">{num == null ? 'N/A' : num.toFixed(2)}</span>
    </div>
  )
}
const VWAPBadge = ({ price, vwap }) => {
  const p = Number(price)
  const v = Number(vwap)
  const isAbove = Number.isFinite(p) && Number.isFinite(v) && p > v
  return (
    <div className={`inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium ${
      isAbove ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
    }`}>
      {isAbove ? <TrendingUp className="w-4 h-4 mr-2" /> : <TrendingDown className="w-4 h-4 mr-2" />}
      {isAbove ? 'Above VWAP' : 'Below VWAP'}
    </div>
  )
}

/* ----------------------------- Format Helpers ----------------------------- */
const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString())
const fmtPE = (v) => (v == null ? '—' : Number(v).toFixed(2))
const fmtBeta = (v) => (v == null ? '—' : Number(v).toFixed(3))
const fmtMoneyAbbrev = (v) => {
  if (v == null || isNaN(v)) return '—'
  const n = Number(v)
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n/1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${(n/1e9).toFixed(2)}B`
  if (abs >= 1e6)  return `${(n/1e6).toFixed(2)}M`
  if (abs >= 1e3)  return `${(n/1e3).toFixed(2)}K`
  return n.toFixed(2)
}

/* ================================== Page ================================== */
export default function Dashboard() {
  // core data
  const [profiles, setProfiles] = useState([])             // from /public/data/stock_profile.csv
  const [selectedTicker, setSelectedTicker] = useState('') // picked ticker
  const [stockData, setStockData] = useState([])           // prices (last 240, from fact_price_daily)
  const [latestByCode, setLatestByCode] = useState({})     // { metric_code: value } from snapshot_metric_latest
  const [loading, setLoading] = useState(true)

  // dims
  const [dimTickerMap, setDimTickerMap] = useState(new Map())   // ticker -> ticker_id
  const [dimTickerById, setDimTickerById] = useState(new Map()) // ticker_id -> ticker
  const [dimMetricMap, setDimMetricMap] = useState(new Map())   // metric_code -> metric_id
  const [dimMetricById, setDimMetricById] = useState(new Map()) // metric_id -> metric_code

  // UI tabs
  const [rvvTab, setRvvTab] = useState('returns') // 'returns' | 'volatility' | 'volume'

  /* ----------------------------- Data Loading ----------------------------- */
  // Load dims + profiles once (from DuckDB-exported CSVs under /public/data)
  useEffect(() => {
    (async () => {
      try {
        // Profiles (keep from stock_profile.csv)
        const profRows = await loadCSV('/data/stock_profile.csv')
        setProfiles(profRows || [])
        if (!selectedTicker && profRows?.length) {
          setSelectedTicker(String(profRows[0].ticker))
        }

        // dim_ticker.csv (columns: ticker_id,ticker,name?)
        const tickRows = await loadCSV('/data/dim_ticker.csv')
        const tMap = new Map()
        const tById = new Map()
        for (const r of tickRows) {
          const id = Number(r.ticker_id)
          const tk = String(r.ticker)
          if (Number.isFinite(id) && tk) {
            tMap.set(tk, id)
            tById.set(id, tk)
          }
        }
        setDimTickerMap(tMap)
        setDimTickerById(tById)

        // dim_metric.csv (columns: metric_id,metric_code,description)
        const metRows = await loadCSV('/data/dim_metric.csv')
        const mMap = new Map()
        const mById = new Map()
        for (const r of metRows) {
          const id = Number(r.metric_id)
          const code = String(r.metric_code)
          if (Number.isFinite(id) && code) {
            mMap.set(code, id)
            mById.set(id, code)
          }
        }
        setDimMetricMap(mMap)
        setDimMetricById(mById)

        // snapshot_metric_latest.csv (columns: ticker_id,metric_id,dt,value)
        const snapRows = await loadCSV('/data/snapshot_metric_latest.csv')
        // Build map: ticker_id -> { metric_code: value }
        const byTicker = new Map()
        for (const r of snapRows) {
          const tid = Number(r.ticker_id)
          const mid = Number(r.metric_id)
          const code = mById.get(mid) || String(mid)
          const val = r.value === '' ? null : Number(r.value)
          if (!byTicker.has(tid)) byTicker.set(tid, {})
          byTicker.get(tid)[code] = Number.isFinite(val) ? val : null
        }
        // keep it globally for quick lookup on ticker change
        window.__snapshotByTicker = byTicker
      } catch (e) {
        console.error('Init load failed:', e)
      }
    })()
  }, []) // run once

  // When ticker changes, load its prices + latest metrics from snapshot
  useEffect(() => {
    (async () => {
      if (!selectedTicker || dimTickerMap.size === 0) return
      setLoading(true)
      try {
        const tid = dimTickerMap.get(String(selectedTicker))

        // ---- Prices from fact_price_daily export ----
        // Preferred: per-ticker CSV at /data/prices/<TICKER>.csv (dt, open, high, low, close, adj_close, volume)
        // Fallback: monolithic /data/fact_price_daily.csv (ticker_id, dt, open, high, low, close, adj_close, volume)
        let priceRows = []
        try {
          priceRows = await loadCSV(`/data/prices/${encodeURIComponent(String(selectedTicker))}.csv`)
        } catch {
          const allPrices = await loadCSV('/data/fact_price_daily.csv')
          priceRows = allPrices.filter(r => Number(r.ticker_id) === Number(tid))
        }

        // Normalize shape (prefer adj_close for analytics)
        const normalized = priceRows.map(r => {
          const dt = r.dt || r.date
          const dstr = typeof dt === 'number' ? new Date(dt).toISOString().slice(0,10) : String(dt)
          const closePref = r.adj_close ?? r.close ?? r.close_price ?? r.closePrice
          return {
            date: dstr,
            displayDate: new Date(dstr).toLocaleDateString('en-US'),
            close: Number(closePref),
            open: Number(r.open ?? r.open_price),
            high: Number(r.high ?? r.high_price),
            low: Number(r.low ?? r.low_price),
            volume: Number(r.volume)
          }
        }).filter(x => Number.isFinite(x.close))
        normalized.sort((a, b) => new Date(a.date) - new Date(b.date))
        const windowed = normalized.slice(Math.max(0, normalized.length - 240))

        // Client-side SMA(20), SMA(100) for overlays
        function rollingSMA(arr, key, win) {
          const out = new Array(arr.length).fill(null)
          let s = 0
          for (let i=0;i<arr.length;i++) {
            s += arr[i][key]
            if (i >= win) s -= arr[i-win][key]
            if (i >= win-1) out[i] = s / win
          }
          return out
        }
        const ma20 = rollingSMA(windowed, 'close', 20)
        const ma100 = rollingSMA(windowed, 'close', 100)
        const withMA = windowed.map((d, i) => ({
          ...d,
          moving_avg_20d: ma20[i],
          moving_avg_100d: ma100[i],
        }))
        setStockData(withMA)

        // Latest metrics from snapshot (already long-format per metric_code)
        const snapMap = window.__snapshotByTicker || new Map()
        const latestObj = snapMap.get(Number(tid)) || {}
        setLatestByCode(latestObj)
      } catch (e) {
        console.error('Ticker load failed:', e)
        setStockData([])
        setLatestByCode({})
      } finally {
        setLoading(false)
      }
    })()
  }, [selectedTicker, dimTickerMap])

  /* ----------------------------- Derived values ----------------------------- */
  const currentProfile = useMemo(
    () => profiles.find(p => String(p.ticker) === String(selectedTicker)) || null,
    [profiles, selectedTicker]
  )

  // 52-week stats from last ~240 trading days (client-side)
  const basicStats = useMemo(() => {
    if (stockData.length === 0) return null
    const highs = stockData.map(d => d.high).filter(Number.isFinite)
    const lows  = stockData.map(d => d.low).filter(Number.isFinite)
    if (!highs.length || !lows.length) return null
    const week52High = Math.max(...highs)
    const week52Low  = Math.min(...lows)
    const latestClose = stockData[stockData.length - 1]?.close
    const range = week52High - week52Low
    const posInRange = range > 0 ? (latestClose - week52Low) / range : 0
    return { week52High, week52Low, latestClose, posInRange }
  }, [stockData])

  // Return distribution for chart (log returns)
  const returnDist = useMemo(() => {
    if (stockData.length < 2) return null
    const closes = stockData.map(d => d.close)
    const rets = []
    for (let i = 1; i < closes.length; i++) {
      const prev = closes[i - 1], curr = closes[i]
      if (prev && curr) rets.push(Math.log(curr / prev))
    }
    if (!rets.length) return null

    const n = rets.length
    const mean = rets.reduce((a,b)=>a+b,0) / n
    const std = Math.sqrt(rets.reduce((a,b)=>a + (b-mean)*(b-mean),0) / n)
    const sorted = [...rets].sort((a,b)=>a-b)
    const median = sorted.length % 2
      ? sorted[(sorted.length-1)/2]
      : 0.5*(sorted[sorted.length/2-1] + sorted[sorted.length/2])

    const bins = 60
    const min = Math.min(...rets), max = Math.max(...rets)
    const pad = 0.2 * (max - min || 1e-6)
    const lo = min - pad, hi = max + pad
    const width = (hi - lo) / bins

    const hist = Array.from({length: bins}, (_, i) => {
      const x0 = lo + i*width
      const x1 = x0 + width
      const center = x0 + width/2
      const count = rets.reduce((acc, r) => acc + (r >= x0 && r < x1 ? 1 : 0), 0)
      const pdf = (1/(std*Math.sqrt(2*Math.PI))) * Math.exp(-0.5 * ((center-mean)/std)**2)
      const normal = pdf * width * n
      return { x: center, count, normal }
    })

    return { hist, mean, median, std }
  }, [stockData])

  const optionLabel = (p) => {
    const name = p.company_name || p.name || null
    if (name) return `${name} (${p.ticker})`
    return p.industry ? `${p.ticker} — ${p.industry}` : p.ticker
  }

  // ---------- Small component for labeled numbers ----------
  function StatLine({ label, value, pct=false, money=false, days=false, pctNegativeIsGood=null }) {
    const num = (value == null || value === '') ? null : Number(value)
    const formatted =
      num == null ? 'N/A'
      : days ? `${num.toFixed(0)} days`
      : money ? `$${fmtMoneyAbbrev(num)}`
      : pct ? `${(num * 100).toFixed(2)}%`
      : num.toFixed(4)

    let positive = null
    if (num != null && pctNegativeIsGood !== null) {
      positive = pctNegativeIsGood ? (num <= 0) : (num >= 0)
    }

    return (
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">{label}</span>
        <span className={`text-sm font-semibold ${positive === null ? 'text-gray-900' : positive ? 'text-green-700' : 'text-red-700'}`}>
          {formatted}
        </span>
      </div>
    )
  }

  // ---------- MA crossover checks (client-side) ----------
  const crossover = useMemo(() => {
    const last = stockData[stockData.length - 1]
    const ma20 = last?.moving_avg_20d
    const ma100 = last?.moving_avg_100d
    const shortBull = (ma20 != null && ma100 != null) ? (ma20 > ma100) : null
    const longBull = null // not computing MA200 client-side here
    return { shortBull, longBull, ma20, ma100 }
  }, [stockData])

  // Helper to fetch metric by code from latestByCode map
  const M = (code) => latestByCode?.[code]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center">
            <BarChart3 className="w-8 h-8 mr-3 text-blue-600" />
            Stock Analysis Dashboard
          </h1>
          <p className="text-gray-600">DuckDB exports: <span className="font-semibold">dim_ticker</span>, <span className="font-semibold">dim_metric</span>, <span className="font-semibold">fact_price_daily</span>, <span className="font-semibold">snapshot_metric_latest</span>, plus <span className="font-semibold">stock_profile.csv</span></p>
        </div>

        {/* Company Profile (from stock_profile.csv) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center">
              <Building2 className="w-5 h-5 mr-2 text-blue-600" />
              Company Profile
            </h2>

            {/* Stock Selector */}
            <div className="flex items-center gap-3">
              <Info className="w-4 h-4 text-gray-400" />
              <select
                value={selectedTicker}
                onChange={(e) => setSelectedTicker(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[260px] bg-white shadow-sm"
              >
                {profiles.length === 0 ? (
                  <option>Loading…</option>
                ) : (
                  profiles
                    .slice()
                    .sort((a,b) => String(a.ticker).localeCompare(String(b.ticker)))
                    .map(p => (
                      <option key={p.ticker} value={p.ticker}>
                        {optionLabel(p)}
                      </option>
                    ))
                )}
              </select>
            </div>
          </div>

          {currentProfile ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-500">Ticker</p>
                <p className="text-lg font-semibold">{currentProfile.ticker}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Exchange</p>
                <p className="text-lg font-semibold">{currentProfile.exchange || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Industry</p>
                <p className="text-lg font-semibold">{currentProfile.industry || '—'}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">GICS Sector</p>
                <p className="text-lg font-semibold">{currentProfile.gics_sector || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">GICS Subsector</p>
                <p className="text-lg font-semibold">{currentProfile.gics_subsector || '—'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Headquarters</p>
                <p className="text-lg font-semibold">{currentProfile.headquarters || '—'}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Market Cap</p>
                <p className="text-lg font-semibold">${fmtMoneyAbbrev(currentProfile.market_cap)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">P/E</p>
                <p className="text-lg font-semibold">{fmtPE(currentProfile.p_e)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Beta</p>
                <p className="text-lg font-semibold">{fmtBeta(currentProfile.beta)}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Employees</p>
                <p className="text-lg font-semibold">{fmtInt(currentProfile.employees)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Shares Outstanding</p>
                <p className="text-lg font-semibold">{fmtInt(currentProfile.shares_outstanding)}</p>
              </div>
            </div>
          ) : (
            <div className="text-gray-500">Select a ticker to see its profile.</div>
          )}
        </div>

        {/* Price Chart (fact_price_daily: dt, open, high, low, close, adj_close, volume) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-green-600" />
            Price Chart - {selectedTicker || '—'} (Last {stockData.length} days)
          </h2>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-pulse text-gray-500">Loading chart data...</div>
            </div>
          ) : stockData.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-gray-500">No data available</div>
          ) : (
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={stockData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="displayDate" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(2) : v)} />
                <Legend />
                <Line type="monotone" dataKey="close" stroke="#2563eb" strokeWidth={2} name="Adj Close" dot={false}/>
                <Line type="monotone" dataKey="open" stroke="#dc2626" strokeWidth={1} name="Open" dot={false}/>
                <Line type="monotone" dataKey="moving_avg_20d" stroke="#10b981" strokeWidth={2} name="MA 20d" dot={false} />
                <Line type="monotone" dataKey="moving_avg_100d" stroke="#9333ea" strokeWidth={2} name="MA 100d" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 52W Stats */}
        {basicStats && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <DollarSign className="w-5 h-5 mr-2 text-blue-600" />
              52-Week (≈240 Trading Days) Statistics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <StatCard title="52-Week High" value={`$${basicStats.week52High.toFixed(2)}`} icon={TrendingUp} positive={true} />
              <StatCard title="52-Week Low" value={`$${basicStats.week52Low.toFixed(2)}`} icon={TrendingDown} positive={false} />
              <StatCard
                title="Position in 52W Range"
                value={`${(basicStats.posInRange * 100).toFixed(1)}%`}
                icon={BarChart3}
                positive={null}
              >
                <ProgressBar value={basicStats.posInRange} max={1} color="blue" />
              </StatCard>
            </div>
          </div>
        )}

        {/* Moving Averages (client-side) */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Activity className="w-5 h-5 mr-2 text-purple-600" />
            Moving Averages (client)
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* MA Values */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold mb-4">Simple Moving Averages</h3>
              <div className="space-y-3">
                {['20d','100d'].map(ma => {
                  const key = ma === '20d' ? 'moving_avg_20d' : 'moving_avg_100d'
                  const last = stockData[stockData.length - 1]
                  const v = last?.[key]
                  return (
                    <div key={ma} className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-600">{ma} MA</span>
                      <span className="font-bold text-gray-900">
                        {v != null ? `$${Number(v).toFixed(2)}` : 'N/A'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            {/* MA Crossover (approx: MA20 vs MA100) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold mb-4">SMA Crossover Check</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Is MA(20) &gt; MA(100)?</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    crossover.shortBull == null
                      ? 'bg-gray-100 text-gray-700'
                      : crossover.shortBull
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                  }`}>
                    {crossover.shortBull == null ? 'N/A' : (crossover.shortBull ? 'Bullish' : 'Bearish')}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Computed on the client from adj close prices (last 240 sessions).
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* =================== Returns · Volatility · Volume (from snapshot_metric_latest) =================== */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-2 flex items-center">
            <Layers className="w-5 h-5 mr-2 text-amber-600" />
            Returns · Volatility · Volume
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Horizons: <span className="font-medium">Trade</span> (≈3 weeks) · <span className="font-medium">Trend</span> (≈3 months) · <span className="font-medium">Tail</span> (1–3 years)
          </p>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            {[
              { key: 'returns', label: 'Returns' },
              { key: 'volatility', label: 'Volatility' },
              { key: 'volume', label: 'Volume' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setRvvTab(t.key)}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition ${
                  rvvTab === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Panel Content */}
          {rvvTab === 'returns' && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Trade */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Trade</h3>
                <div className="space-y-3">
                  <StatLine label="5d Return" value={M('5_day_ret')} pct />
                  <StatLine label="10d Return" value={M('10_day_ret')} pct />
                  <StatLine label="20d Return" value={M('20_day_ret')} pct />
                  <StatLine label="Return ROC (10d − prior 10d)" value={M('change_10dayret')} />
                </div>
              </div>
              {/* Trend */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Trend</h3>
                <div className="space-y-3">
                  <StatLine label="40d Return" value={M('40_day_ret')} pct />
                  <StatLine label="60d Return" value={M('60_day_ret')} pct />
                  <StatLine label="Return Acceleration (60d)" value={M('60d_return_accel')} />
                </div>
              </div>
              {/* Tail */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Tail</h3>
                <div className="space-y-3">
                  <StatLine label="200d Return" value={M('200_day_ret')} pct />
                  <StatLine label="300d Return" value={M('300_day_ret')} pct />
                  <StatLine label="Mean Return (100d)" value={M('mean_return_100d')} pct />
                  <StatLine label="Median Return (100d)" value={M('median_return_100d')} pct />
                </div>
              </div>
            </div>
          )}

          {rvvTab === 'volatility' && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Trade */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Trade</h3>
                <div className="space-y-3">
                  <StatLine label="Volatility (5d)" value={M('5d_volatility')} pct />
                  <StatLine label="Volatility (15d)" value={M('15d_volatility')} pct />
                  <StatLine label="EMA(5d) of 15d Vol" value={M('5d_EMA_15dayvolatility')} pct />
                  <StatLine label="Slope of 60d Vol (20d)" value={M('slope_over20_of_60d_volatility')} />
                </div>
              </div>
              {/* Trend */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Trend</h3>
                <div className="space-y-3">
                  <StatLine label="Volatility (60d)" value={M('60d_volatility')} pct />
                  <StatLine label="Parkinson HL Vol (20d)" value={M('20d_parkinson_HL_volatility')} pct />
                  <StatLine label="Downside Deviation (60d)" value={M('60d_downsidedeviation')} pct />
                  <StatLine label="Upside Volatility (60d)" value={M('60d_upsidevolatility')} pct />
                </div>
              </div>
              {/* Tail */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Tail</h3>
                <div className="space-y-3">
                  <StatLine label="Volatility (252d)" value={M('252d_volatility')} pct />
                  <StatLine label="Slope of 252d Vol (60d)" value={M('slope_over60_of_252d_volatility')} />
                  <StatLine label="Downside Deviation (252d)" value={M('252d_downsidedeviation')} pct />
                  <StatLine label="Upside Volatility (252d)" value={M('252d_upsidevolatility')} pct />
                </div>
              </div>

              {/* Extreme Risk */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 xl:col-span-3">
                <h3 className="text-lg font-semibold mb-2">Extreme Risk</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <StatLine label="Current Drawdown %" value={M('drawdown_percent')} pct pctNegativeIsGood={false} />
                  <StatLine label="Drawdown Duration" value={M('drawdown_duration_days')} days />
                  <StatLine label="Max Drawdown (750d)" value={M('750d_drawdown')} pct pctNegativeIsGood={false} />
                  <StatLine label="Max DD Duration (750d)" value={M('750d_drawdownduration')} days />
                </div>
              </div>
            </div>
          )}

          {rvvTab === 'volume' && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Trade */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Trade</h3>
                <div className="space-y-3">
                  <StatLine label="OBV Slope (10d)" value={M('10d_OBV_slope')} />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Vol Accel (5d)</span>
                    <VolAccelBadge label="" value={M('vol_accel_5d')} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Vol Accel (10d)</span>
                    <VolAccelBadge label="" value={M('vol_accel_10d')} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Abnormal $ Vol (60d z)</span>
                    <AbnVolBadge z={M('abn_vol_60d')} />
                  </div>
                </div>
              </div>
              {/* Trend */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Trend</h3>
                <div className="space-y-3">
                  <StatLine label="$ Volume SMA (60d)" value={M('60d_dollar_volume_SMA')} money />
                  <StatLine label="Price–$Volume Correlation (60d)" value={M('60d_price_dollarVolume_correlation')} />
                </div>
              </div>
              {/* Tail */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
                <h3 className="text-lg font-semibold mb-2">Tail</h3>
                <div className="space-y-3">
                  <StatLine label="$ Volume SMA (252d)" value={M('252d_dollar_volume_SMA')} money />
                  <StatLine label="$ Volume Acceleration (252d)" value={M('252d_dollar_volume_accel')} />
                  <StatLine label="OBV (level)" value={M('OBV')} />
                </div>
              </div>
              <div className="text-xs text-gray-500 xl:col-span-3">
                Note: Dollar volume = price × shares; correlations use the last 60 sessions.
              </div>
            </div>
          )}
        </div>
        {/* =================== /Returns · Volatility · Volume =================== */}

        {/* VWAP (from snapshot) */}
        {M('vwap_20d') != null && basicStats && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <Target className="w-5 h-5 mr-2 text-indigo-600" />
              VWAP Analysis
            </h2>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold mb-2">20d VWAP vs Current Price</h3>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">VWAP: <span className="font-bold">${Number(M('vwap_20d')).toFixed(2)}</span></span>
                    <span className="text-sm text-gray-600">Current: <span className="font-bold">${basicStats.latestClose.toFixed(2)}</span></span>
                  </div>
                </div>
                <VWAPBadge price={basicStats.latestClose} vwap={M('vwap_20d')} />
              </div>
            </div>
          </div>
        )}

        {/* Return Distribution (from prices) */}
        {returnDist && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2 text-green-600" />
              Return Metrics
            </h2>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
              <h3 className="text-lg font-semibold mb-4">Daily Return Distribution (Last 240 Trading Days)</h3>
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={returnDist.hist} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" tickFormatter={(v) => `${(v*100).toFixed(1)}%`} domain={['auto', 'auto']} />
                  <YAxis yAxisId="left" allowDecimals={false} />
                  <YAxis yAxisId="right" orientation="right" hide />
                  <Tooltip formatter={(val, name) => name === 'normal' ? Math.round(val) : val} labelFormatter={(v) => `Bin center: ${(v*100).toFixed(2)}%`} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" name="Frequency" />
                  <Line yAxisId="left" type="monotone" dataKey="normal" name="Normal (scaled)" dot={false} />
                  <ReferenceLine x={returnDist.mean} stroke="#2563eb" strokeDasharray="4 4" label={{ value: `Mean ${(returnDist.mean*100).toFixed(2)}%`, position: 'insideTopRight' }} />
                  <ReferenceLine x={returnDist.median} stroke="#10b981" strokeDasharray="4 4" label={{ value: `Median ${(returnDist.median*100).toFixed(2)}%`, position: 'insideTopLeft' }} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="mt-3 text-sm text-gray-600 flex gap-6">
                <span>Mean: <span className="font-semibold">{(returnDist.mean*100).toFixed(2)}%</span></span>
                <span>Median: <span className="font-semibold">{(returnDist.median*100).toFixed(2)}%</span></span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <StatCard
                title="100d Mean Return"
                value={M('mean_return_100d') != null ? `${(Number(M('mean_return_100d')) * 100).toFixed(4)}%` : 'N/A'}
                icon={BarChart3}
                positive={M('mean_return_100d') != null ? Number(M('mean_return_100d')) > 0 : null}
              />
              <StatCard
                title="100d Median Return"
                value={M('median_return_100d') != null ? `${(Number(M('median_return_100d')) * 100).toFixed(4)}%` : 'N/A'}
                icon={BarChart3}
                positive={M('median_return_100d') != null ? Number(M('median_return_100d')) > 0 : null}
              />
            </div>
          </div>
        )}

        {/* Risk Metrics (from snapshot) */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <AlertCircle className="w-5 h-5 mr-2 text-red-600" />
            Risk Metrics
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold mb-4">Volatility</h3>
              <div className="space-y-4">
                {M('volatility_20d') != null && (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-gray-600">20d Volatility</span>
                      <span className="text-sm font-bold text-gray-900">{(Number(M('volatility_20d')) * 100).toFixed(2)}%</span>
                    </div>
                    <ProgressBar value={Number(M('volatility_20d'))} max={1} color="red" />
                  </div>
                )}
                {M('volatility_100d') != null && (
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-gray-600">100d Volatility</span>
                      <span className="text-sm font-bold text-gray-900">{(Number(M('volatility_100d')) * 100).toFixed(2)}%</span>
                    </div>
                    <ProgressBar value={Number(M('volatility_100d'))} max={1} color="yellow" />
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-semibold mb-4">Drawdown</h3>
              <div className="space-y-4">
                <StatCard
                  title="Drawdown %"
                  value={
                    M('drawdown_percent') == null
                      ? 'N/A'
                      : `${(Number(M('drawdown_percent')) * 100).toFixed(2)}%`
                  }
                  icon={TrendingDown}
                  positive={false}
                />
                <StatCard
                  title="Drawdown Duration"
                  value={
                    M('drawdown_duration_days') == null
                      ? 'N/A'
                      : `${Number(M('drawdown_duration_days')).toFixed(0)} days`
                  }
                  icon={Clock}
                  positive={null}
                />
              </div>
            </div>
          </div>
        </div>

        {/* (Optional) raw latest snapshot preview could go here */}

      </div>
    </div>
  )
}
