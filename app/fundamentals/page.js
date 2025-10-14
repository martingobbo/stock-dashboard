'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { TrendingUp, Activity, PiggyBank, Gauge, AlertTriangle } from 'lucide-react'

// ---- Recharts (client-only) ----
const ResponsiveContainer = dynamic(() => import('recharts').then(m => m.ResponsiveContainer), { ssr: false })
const LineChart = dynamic(() => import('recharts').then(m => m.LineChart), { ssr: false })
const Line = dynamic(() => import('recharts').then(m => m.Line), { ssr: false })
const XAxis = dynamic(() => import('recharts').then(m => m.XAxis), { ssr: false })
const YAxis = dynamic(() => import('recharts').then(m => m.YAxis), { ssr: false })
const CartesianGrid = dynamic(() => import('recharts').then(m => m.CartesianGrid), { ssr: false })
const Tooltip = dynamic(() => import('recharts').then(m => m.Tooltip), { ssr: false })
const Legend = dynamic(() => import('recharts').then(m => m.Legend), { ssr: false })
const BarChart = dynamic(() => import('recharts').then(m => m.BarChart), { ssr: false })
const Bar = dynamic(() => import('recharts').then(m => m.Bar), { ssr: false })

/* ---------------- helpers ---------------- */
function pct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return '—'
  const sign = Number(x) > 0 ? '+' : ''
  return `${sign}${(Number(x) * 100).toFixed(digits)}%`
}
function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return '—'
  const abs = Math.abs(Number(x))
  if (abs >= 1e12) return `${(Number(x) / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `${(Number(x) / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(Number(x) / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(Number(x) / 1e3).toFixed(1)}K`
  return `${x}`
}
const money = (x) => {
  if (x==null || isNaN(Number(x))) return '—'
  const n = Number(x), a = Math.abs(n)
  if (a >= 1e12) return (n/1e12).toFixed(2)+'T'
  if (a >= 1e9)  return (n/1e9).toFixed(2)+'B'
  if (a >= 1e6)  return (n/1e6).toFixed(2)+'M'
  if (a >= 1e3)  return (n/1e3).toFixed(2)+'K'
  return n.toLocaleString()
}
function kpiTint(v) {
  if (v === null || v === undefined) return 'text-muted-foreground'
  if (Math.abs(Number(v)) < 0.005) return 'text-foreground'
  return Number(v) > 0 ? 'text-emerald-600' : 'text-rose-600'
}
function safeLatest(arr) { return (arr && arr.length) ? arr[arr.length - 1] : null }
function sortByDateAsc(rows) { return (rows || []).slice().sort((a, b) => String(a?.date).localeCompare(String(b?.date))) }
function sortByDateDesc(rows) { return (rows || []).slice().sort((a, b) => String(b?.date).localeCompare(String(a?.date))) }
function safeDiv(a, b) {
  const x = Number(a), y = Number(b)
  if (!isFinite(x) || !isFinite(y) || y === 0) return null
  return x / y
}
const yesno = (b) => b == null ? '—' : (b ? 'Yes' : 'No')

/* -------- timeframe helpers (charts) -------- */
function parseDateSafe(s) {
  if (!s) return null
  const parts = String(s).split('-')
  const y = Number(parts[0]); const m = parts[1] ? Number(parts[1]) - 1 : 0; const d = parts[2] ? Number(parts[2]) : 1
  const dt = new Date(Date.UTC(y, m, d))
  return isNaN(dt.getTime()) ? null : dt
}
function cutoffForYears(latestDateStr, years) {
  const latest = parseDateSafe(latestDateStr)
  if (!latest) return null
  const c = new Date(latest.getTime())
  c.setUTCFullYear(c.getUTCFullYear() - years)
  return c
}
function filterRowsByTimeframe(rows, timeframe) {
  if (!rows?.length) return []
  if (timeframe === 'ALL') return rows
  const latest = rows[rows.length - 1]
  const latestDateStr = latest?.date
  if (!latestDateStr) return rows
  const years = timeframe === '3Y' ? 3 : timeframe === '5Y' ? 5 : timeframe === '10Y' ? 10 : null
  if (!years) return rows
  const cutoff = cutoffForYears(latestDateStr, years)
  if (!cutoff) return rows
  return rows.filter(r => {
    const dt = parseDateSafe(r.date)
    return dt && dt >= cutoff
  })
}

/* ---------------- atoms ---------------- */
function SummaryCard({ title, value, fmtFn, icon:Icon, sub }) {
  return (
    <div className="rounded-xl border p-4 bg-white">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="w-4 h-4"/> {title}</div>
      <div className={`text-2xl font-semibold mt-1 ${kpiTint(value)}`}>{fmtFn(value)}</div>
      {sub ? <div className="text-xs text-muted-foreground mt-1">{sub}</div> : null}
    </div>
  )
}
function Section({ title, icon:Icon }) {
  return (
    <div className="flex items-center gap-2 mb-2 mt-6">
      <Icon className="w-4 h-4"/>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
    </div>
  )
}
function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
function FlagRow({ label, v, help }) {
  const text = v === true ? 'Yes' : v === false ? 'No' : '—'
  const cls = v === true ? 'text-rose-600' : v === false ? 'text-emerald-600' : 'text-muted-foreground'
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-medium ${cls}`}>{text}</div>
      {help ? <div className="text-xs text-muted-foreground mt-1">{help}</div> : null}
    </div>
  )
}

/* ------------- Overview section (used in both FY and Quarterly tabs) ------------- */
function OverviewSection({ latestFY, latestQ, context }) {
  // context: 'FY' or 'Quarterly'
  const srcYoY = context === 'FY' ? latestFY : latestQ
  const srcQoQ = latestQ
  const srcCAGR = latestFY

  const rows = [
    {
      label: 'Revenue',
      yoy: srcYoY?.revenue_growth_yoy,
      qoq: srcQoQ?.revenue_growth_qoq,
      cagr: srcCAGR?.revenue_cagr_3y,
      accel_yoy: srcYoY?.revenue_growth_accel_yoy,
      accel_qoq: srcQoQ?.revenue_growth_accel_qoq,
    },
    {
      label: 'Net Income',
      yoy: srcYoY?.net_income_growth_yoy,
      qoq: srcQoQ?.net_income_growth_qoq,
      cagr: srcCAGR?.net_income_cagr_3y,
      accel_yoy: srcYoY?.net_income_growth_accel_yoy,
      accel_qoq: srcQoQ?.net_income_growth_accel_qoq,
    },
    {
      label: 'Free Cash Flow',
      yoy: srcYoY?.fcf_growth_yoy,
      qoq: srcQoQ?.fcf_growth_qoq,
      cagr: srcCAGR?.fcf_cagr_3y,
      accel_yoy: srcYoY?.fcf_growth_accel_yoy,
      accel_qoq: srcQoQ?.fcf_growth_accel_qoq,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Growth table */}
        <div className="rounded-xl border p-4 bg-white row-span-2 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4"/><div className="font-semibold">Growth</div>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 w-48">Category</th>
                  <th className="text-right px-3 py-2">YoY</th>
                  <th className="text-right px-3 py-2">QoQ</th>
                  <th className="text-right px-3 py-2">3 Year CAGR</th>
                  <th className="text-right px-3 py-2">Acceleration YoY</th>
                  <th className="text-right px-3 py-2">Acceleration QoQ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.label} className={i % 2 ? 'bg-white' : 'bg-slate-50/30'}>
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.yoy)}`}>{pct(r.yoy)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.qoq)}`}>{pct(r.qoq)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.cagr)}`}>{pct(r.cagr)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.accel_yoy)}`}>{pct(r.accel_yoy)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.accel_qoq)}`}>{pct(r.accel_qoq)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grow" />
        </div>

        {/* Profitability (KPIs snapshot) */}
        <div className="rounded-xl border p-4 bg-white">
          <div className="flex items-center gap-2 mb-2"><Gauge className="w-4 h-4"/><div className="font-semibold">Profitability</div></div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">EBITDA margin</span>
              <span className="font-medium">{pct(safeDiv(latestFY?.EBITDA, latestFY?.revenue))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net margin</span>
              <span className="font-medium">{pct(latestFY?.netMargin)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Operating leverage</span>
              <span className="font-medium">{pct(latestFY?.operating_leverage_ratio)}</span>
            </div>
          </div>
        </div>

        {/* Quarterly Momentum snapshot */}
        <div className="rounded-xl border p-4 bg-white">
          <div className="flex items-center gap-2 mb-2"><Activity className="w-4 h-4"/><div className="font-semibold">Quarterly Momentum</div></div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Rev QoQ</span>
              <span className="font-medium">{pct(latestQ?.revenue_growth_qoq)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">NI QoQ</span>
              <span className="font-medium">{pct(latestQ?.net_income_growth_qoq)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">FCF QoQ</span>
              <span className="font-medium">{pct(latestQ?.fcf_growth_qoq)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ===================== FY TAB ===================== */
function FYTab({ FY, latestFY, latestQ, timeframe }) {
  const chartRows = useMemo(() => filterRowsByTimeframe(FY, timeframe), [FY, timeframe])

  const chartLevel = useMemo(() => chartRows.map(r => ({
    date: r.date,
    revenue: r.revenue,
    netIncome: r.netIncome,
    fcf: r.freeCashFlow
  })), [chartRows])

  const chartYoY = useMemo(() => chartRows.map(r => ({
    date: r.date,
    revYoY: r.revenue_growth_yoy,
    niYoY: r.net_income_growth_yoy
  })), [chartRows])

  const chartProfit = useMemo(() => chartRows.map(r => ({
    date: r.date,
    netMargin: r.netMargin,
    ROE: r.ROE,
    ROA: r.ROA,
  })), [chartRows])

  return (
    <div className="space-y-6">
      {/* Overview section (shared) */}
      <OverviewSection latestFY={latestFY} latestQ={latestQ} context="FY" />

      {/* Trends — Revenue, Net Income, Free Cash Flow (distinct colors) */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-medium text-gray-700">Trends — Revenue, Net Income, Free Cash Flow</div>
        <div className="w-full h-80">
          <ResponsiveContainer>
            <LineChart data={chartLevel}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(v)=>money(v)} />
              <Legend />
              <Line type="monotone" dataKey="revenue" name="Revenue" dot={false} stroke="#2563EB" strokeWidth={2} />
              <Line type="monotone" dataKey="netIncome" name="Net Income" dot={false} stroke="#16A34A" strokeWidth={2} />
              <Line type="monotone" dataKey="fcf" name="Free Cash Flow" dot={false} stroke="#8B5CF6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* YoY Growth — Rev & NI (distinct bar colors) */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-medium text-gray-700">YoY Growth — Revenue & Net Income</div>
        <div className="w-full h-72">
          <ResponsiveContainer>
            <BarChart data={chartYoY}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Bar dataKey="revYoY" name="Revenue YoY" fill="#2563EB" />
              <Bar dataKey="niYoY" name="Net Income YoY" fill="#F97316" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Profitability — Net Margin, ROE, ROA (distinct colors) */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-medium text-gray-700">Profitability — Net Margin, ROE, ROA</div>
        <div className="w-full h-72">
          <ResponsiveContainer>
            <LineChart data={chartProfit}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Line type="monotone" dataKey="netMargin" name="Net Margin" dot={false} stroke="#14B8A6" strokeWidth={2} />
              <Line type="monotone" dataKey="ROE" name="ROE" dot={false} stroke="#7C3AED" strokeWidth={2} />
              <Line type="monotone" dataKey="ROA" name="ROA" dot={false} stroke="#334155" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Diagnostics / Flags (kept) */}
      <div className="rounded-xl border p-4 bg-white">
        <Section title="Diagnostics / Flags" icon={AlertTriangle} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
          <FlagRow label="Receivables vs Sales" v={latestFY?.receivables_vs_sales_flag} help="AR growth outpacing sales by >10%." />
          <FlagRow label="Debt↑ without Assets↑" v={latestFY?.debt_up_without_asset_growth_flag} help="Debt growth > asset growth by >10%." />
          <FlagRow label="Quarterly vol masks annual" v={latestFY?.quarterly_volatility_masks_annual_flag} help="High Q growth volatility while annual growth ~flat." />
        </div>
      </div>
    </div>
  )
}

/* ===================== QUARTERLY TAB ===================== */
function QuarterlyTab({ Q, latestQ, latestFY, timeframe }) {
  const chartRows = useMemo(() => filterRowsByTimeframe(Q, timeframe), [Q, timeframe])

  // NEW: Use actual quarterly level numbers for the 1st chart
  const chartLevelQ = useMemo(() => chartRows.map(r => ({
    date: r.date,
    revenue: r.revenue,
    netIncome: r.netIncome,
    fcf: r.freeCashFlow
  })), [chartRows])

  const chartQoQ = useMemo(() => chartRows.map(r => ({
    date: r.date,
    revQoQ: r.revenue_growth_qoq,
    niQoQ: r.net_income_growth_qoq,
    fcfQoQ: r.fcf_growth_qoq
  })), [chartRows])

  const chartYoY = useMemo(() => chartRows.map(r => ({
    date: r.date,
    revYoY: r.revenue_growth_yoy,
    niYoY: r.net_income_growth_yoy,
    fcfYoY: r.fcf_growth_yoy
  })), [chartRows])

  const chartMargins = useMemo(() => chartRows.map(r => ({
    date: r.date,
    grossMargin: r.grossMargin,
    operatingMargin: r.operatingMargin,
    netMargin: r.netMargin
  })), [chartRows])

  return (
    <div className="space-y-6">
      {/* Overview section (shared) */}
      <OverviewSection latestFY={latestFY} latestQ={latestQ} context="Quarterly" />

      {/* CHANGED: First chart now shows actual quarterly level numbers */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-medium text-gray-700">QoQ Growth — Rev / NI / FCF</div>
        <div className="w-full h-64">
          <ResponsiveContainer>
            <LineChart data={chartLevelQ}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(v)=>money(v)} />
              <Legend />
              <Line type="monotone" dataKey="revenue" name="Revenue" dot={false} stroke="#2563EB" strokeWidth={2} />
              <Line type="monotone" dataKey="netIncome" name="Net Income" dot={false} stroke="#F97316" strokeWidth={2} />
              <Line type="monotone" dataKey="fcf" name="Free Cash Flow" dot={false} stroke="#8B5CF6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* CHANGED: Second chart now is QoQ Growth (percent) and title updated */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-medium text-gray-700">QoQ Growth — Rev / NI / FCF</div>
        <div className="w-full h-64">
          <ResponsiveContainer>
            <LineChart data={chartQoQ}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Line type="monotone" dataKey="revQoQ" name="Rev QoQ" dot={false} stroke="#2563EB" strokeWidth={2} />
              <Line type="monotone" dataKey="niQoQ" name="NI QoQ" dot={false} stroke="#F97316" strokeWidth={2} />
              <Line type="monotone" dataKey="fcfQoQ" name="FCF QoQ" dot={false} stroke="#8B5CF6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quarterly Margins (unchanged) */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-3 text-sm font-medium text-gray-700">Quarterly Margins</div>
        <div className="w-full h-56">
          <ResponsiveContainer>
            <LineChart data={chartMargins}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Line type="monotone" dataKey="grossMargin" name="Gross" dot={false} stroke="#F59E0B" strokeWidth={2} />
              <Line type="monotone" dataKey="operatingMargin" name="Operating" dot={false} stroke="#6366F1" strokeWidth={2} />
              <Line type="monotone" dataKey="netMargin" name="Net" dot={false} stroke="#F43F5E" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Diagnostics / Flags (parity with FY) */}
      <div className="rounded-xl border p-4 bg-white">
        <Section title="Diagnostics / Flags" icon={AlertTriangle} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
          <FlagRow label="Receivables vs Sales" v={latestFY?.receivables_vs_sales_flag} help="AR growth outpacing sales by >10%." />
          <FlagRow label="Debt↑ without Assets↑" v={latestFY?.debt_up_without_asset_growth_flag} help="Debt growth > asset growth by >10%." />
          <FlagRow label="Quarterly vol masks annual" v={latestFY?.quarterly_volatility_masks_annual_flag} help="High Q growth volatility while annual growth ~flat." />
        </div>
      </div>
    </div>
  )
}

/* ===================== MAIN PAGE ===================== */
export default function Page() {
  const [bundle, setBundle] = useState([])
  const [symbol, setSymbol] = useState('')
  const [tab, setTab] = useState('FY') // FY | Quarterly
  const [timeframe, setTimeframe] = useState('5Y') // charts only
  const [loading, setLoading] = useState(true)
  const [showTable, setShowTable] = useState(false) // collapsible detail table
  const [cadenceForTable, setCadenceForTable] = useState('FY') // FY | Q

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    fetch('/data/fundamentals_highlights.json', { cache: 'no-store' })
      .then(r => r.json())
      .then(all => {
        if (!isMounted) return
        const clean = Array.isArray(all) ? all.filter(d => d && d.symbol && (d.FY || d.Q)) : []
        setBundle(clean)
        if (clean.length && !symbol) setSymbol(clean[0].symbol)
      })
      .catch(() => setBundle([]))
      .finally(() => { if (isMounted) setLoading(false) })
    return () => { isMounted = false }
  }, [])

  const record = useMemo(() => bundle.find(r => r.symbol === symbol), [bundle, symbol])
  const FY = useMemo(() => sortByDateAsc(record?.FY || []), [record])
  const Q = useMemo(() => sortByDateAsc(record?.Q || []), [record])
  const latestFY = safeLatest(FY)
  const latestQ = safeLatest(Q)

  const ebitdaMargin = useMemo(() => {
    const e = Number(latestFY?.EBITDA ?? NaN)
    const rev = Number(latestFY?.revenue ?? NaN)
    if (!isFinite(e) || !isFinite(rev) || rev === 0) return null
    return e / rev
  }, [latestFY])

  const tableRows = useMemo(() => {
    const base = cadenceForTable === 'FY' ? (record?.FY || []) : (record?.Q || [])
    return sortByDateDesc(base)
  }, [record, cadenceForTable])

  return (
    <main className="min-h-screen p-6 bg-gradient-to-b from-white to-gray-50">
      <h1 className="text-2xl font-bold mb-1">Fundamentals Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-6">
        FY & Quarterly: shared Overview + Diagnostics; charts vary by tab.
      </p>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select className="border rounded-md px-3 py-2" value={symbol} onChange={e => setSymbol(e.target.value)} disabled={loading || !bundle.length}>
          {(bundle.length ? bundle : [{symbol:'—'}]).map(r => (
            <option key={r.symbol} value={r.symbol}>{r.symbol}</option>
          ))}
        </select>

        <div className="flex gap-2">
          {['FY','Quarterly'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 rounded-md border ${tab===t ? 'bg-black text-white' : 'bg-white'}`}>{t}</button>
          ))}
        </div>

        {/* timeframe applies to charts only */}
        <select
          value={timeframe}
          onChange={e => setTimeframe(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm"
          title="Timeframe for charts"
        >
          <option value="3Y">3 Years</option>
          <option value="5Y">5 Years</option>
          <option value="10Y">10 Years</option>
          <option value="ALL">All Time</option>
        </select>

        {/* Collapsible detail table controls */}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={cadenceForTable}
            onChange={e => setCadenceForTable(e.target.value)}
            className="rounded-md border px-2 py-1 text-sm bg-white"
            title="Cadence for Detailed Table"
          >
            <option value="FY">FY</option>
            <option value="Q">Quarterly</option>
          </select>
          <button
            onClick={() => setShowTable(s => !s)}
            className="px-3 py-2 rounded-md border bg-white text-sm"
            title="Toggle Detailed Table"
          >
            {showTable ? 'Hide Table' : 'Show Table'}
          </button>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard title="Revenue YoY" icon={TrendingUp} value={tab==='Quarterly' ? latestQ?.revenue_growth_yoy : latestFY?.revenue_growth_yoy} fmtFn={pct} />
        <SummaryCard title="Net Income YoY" icon={TrendingUp} value={tab==='Quarterly' ? latestQ?.net_income_growth_yoy : latestFY?.net_income_growth_yoy} fmtFn={pct} />
        <SummaryCard title="FCF YoY" icon={TrendingUp} value={tab==='Quarterly' ? latestQ?.fcf_growth_yoy : latestFY?.fcf_growth_yoy} fmtFn={pct} />
        <SummaryCard title="EBITDA (lvl)" icon={PiggyBank} value={latestFY?.EBITDA} fmtFn={fmt} sub={`EBITDA margin: ${pct(ebitdaMargin)}`} />
      </div>

      {loading ? (
        <div className="text-gray-500">Loading data…</div>
      ) : !record ? (
        <div className="text-gray-500">No data. Ensure <code>public/data/fundamentals_highlights.json</code> exists.</div>
      ) : (
        <>
          {tab === 'FY' && (
            <FYTab FY={FY} latestFY={latestFY} latestQ={latestQ} timeframe={timeframe} />
          )}

          {tab === 'Quarterly' && (
            <QuarterlyTab Q={Q} latestQ={latestQ} latestFY={latestFY} timeframe={timeframe} />
          )}

          {/* Collapsible Detailed Table (most recent first) */}
          {showTable && (
            <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-medium text-gray-700">
                Detailed Table — {cadenceForTable === 'FY' ? 'Annual (FY)' : 'Quarterly (Q)'} — Most Recent First
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 sticky top-0">
                    <tr>
                      {[
                        { key: 'date', label: 'Date', fmt: (x)=>x },
                        { key: 'revenue', label: 'Revenue', fmt: money },
                        { key: 'netIncome', label: 'Net Income', fmt: money },
                        { key: 'freeCashFlow', label: 'FCF', fmt: money },
                        { key: 'grossMargin', label: 'Gross %', fmt: pct },
                        { key: 'operatingMargin', label: 'Op %', fmt: pct },
                        { key: 'netMargin', label: 'Net %', fmt: pct },
                        { key: 'revenue_growth_yoy', label: 'Rev YoY', fmt: pct },
                        { key: 'net_income_growth_yoy', label: 'NI YoY', fmt: pct },
                        { key: 'gross_margin_expansion', label: 'Gross Δ YoY', fmt: pct },
                        { key: 'operating_margin_expansion', label: 'Op Δ YoY', fmt: pct },
                        { key: 'net_margin_expansion', label: 'Net Δ YoY', fmt: pct },
                        { key: 'operating_leverage_ratio', label: 'Op Leverage', fmt: (x)=>x==null?'—':Number(x).toFixed(2)+'×' },
                        { key: 'ROE', label: 'ROE', fmt: pct },
                        { key: 'ROA', label: 'ROA', fmt: pct },
                        { key: 'receivables_vs_sales_flag', label: 'Rec>Sales', fmt: yesno },
                        { key: 'debt_up_without_asset_growth_flag', label: 'Debt↑ no Asset↑', fmt: yesno },
                        { key: 'quarterly_volatility_masks_annual_flag', label: 'Q Vol Masks Annual', fmt: yesno },
                      ].map(col => (
                        <th key={col.key} className={`px-3 py-2 ${col.key==='date'?'text-left':'text-right'}`}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r, idx) => (
                      <tr key={r.date + '_' + idx} className="border-t">
                        <td className="px-3 py-2 text-left">{r.date}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(r.revenue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(r.netIncome)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(r.freeCashFlow)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.grossMargin)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.operatingMargin)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.netMargin)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.revenue_growth_yoy)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.net_income_growth_yoy)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.gross_margin_expansion)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.operating_margin_expansion)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.net_margin_expansion)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.operating_leverage_ratio==null?'—':Number(r.operating_leverage_ratio).toFixed(2)+'×'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.ROE)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(r.ROA)}</td>
                        <td className="px-3 py-2 text-right">{yesno(r.receivables_vs_sales_flag)}</td>
                        <td className="px-3 py-2 text-right">{yesno(r.debt_up_without_asset_growth_flag)}</td>
                        <td className="px-3 py-2 text-right">{yesno(r.quarterly_volatility_masks_annual_flag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Timeframe selector affects charts only. Table always shows full history for selected cadence.
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
