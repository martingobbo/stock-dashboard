'use client'

// Client dashboard implementing Overview | FY | Quarterly layout
// Reads /public/data/fundamentals_highlights.json and renders KPIs, charts, and flags

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

function pct(x, digits = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  const sign = x > 0 ? '+' : ''
  return `${sign}${(x * 100).toFixed(digits)}%`
}
function fmt(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  const abs = Math.abs(x)
  if (abs >= 1e12) return `${(x / 1e12).toFixed(1)}T`
  if (abs >= 1e9) return `${(x / 1e9).toFixed(1)}B`
  if (abs >= 1e6) return `${(x / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${(x / 1e3).toFixed(1)}K`
  return `${x}`
}

function kpiTint(v) {
  if (v === null || v === undefined) return 'text-muted-foreground'
  if (Math.abs(v) < 0.005) return 'text-foreground'
  return v > 0 ? 'text-emerald-600' : 'text-rose-600'
}

function safeLatest(arr) { return (arr && arr.length) ? arr[arr.length - 1] : null }
function sortByDate(rows) {
  return (rows || []).slice().sort((a, b) => String(a?.date).localeCompare(String(b?.date)))
}
function safeDiv(a, b) {
  const x = Number(a), y = Number(b)
  if (!isFinite(x) || !isFinite(y) || y === 0) return null
  return x / y
}

function SummaryCard({ title, value, fmt, icon:Icon, sub }) {
  return (
    <div className="rounded-xl border p-4 bg-white">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="w-4 h-4"/> {title}</div>
      <div className={`text-2xl font-semibold mt-1 ${kpiTint(value)}`}>{fmt(value)}</div>
      {sub ? <div className="text-xs text-muted-foreground mt-1">{sub}</div> : null}
    </div>
  )
}

function KPI({ label, value, formatter=pct }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-medium ${kpiTint(value)}`}>{formatter(value)}</div>
    </div>
  )
}

function Chip({ label, value }) {
  const color = kpiTint(value)
  const arrow = value === null || value === undefined ? '' : value > 0 ? '▲' : value < 0 ? '▼' : '•'
  return (
    <div className={`px-2 py-1 rounded-full border text-xs inline-flex items-center gap-1 ${color}`}>
      <span>{arrow}</span>
      <span className="text-foreground/70">{label}:</span>
      <span className="font-medium">{pct(value)}</span>
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
      <div className="text-xs text-muted-foreground mt-1">{help}</div>
    </div>
  )
}

/* ===================== OVERVIEW ===================== */
function OverviewTab({ latestFY, latestQ }) {
  // Rows = Revenue / NI / FCF; Cols = YoY, 3Y CAGR, Accel YoY
  const rows = [
    {
      label: 'Revenue',
      yoy: latestFY?.revenue_growth_yoy,
      cagr: latestFY?.revenue_cagr_3y,
      accel: latestFY?.revenue_growth_accel_yoy,
    },
    {
      label: 'Net Income',
      yoy: latestFY?.net_income_growth_yoy,
      cagr: latestFY?.net_income_cagr_3y,
      accel: latestFY?.net_income_growth_accel_yoy,
    },
    {
      label: 'Free Cash Flow',
      yoy: latestFY?.fcf_growth_yoy,
      cagr: latestFY?.fcf_cagr_3y,
      accel: latestFY?.fcf_growth_accel_yoy,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Growth (FY) table spanning two rows */}
        <div className="rounded-xl border p-4 bg-white row-span-2 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4"/><div className="font-semibold">Growth (FY)</div>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 w-48">Category</th>
                  <th className="text-right px-3 py-2">YoY</th>
                  <th className="text-right px-3 py-2">3 Year CAGR</th>
                  <th className="text-right px-3 py-2">Acceleration YoY</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.label} className={i % 2 ? 'bg-white' : 'bg-slate-50/30'}>
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.yoy)}`}>{pct(r.yoy)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.cagr)}`}>{pct(r.cagr)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${kpiTint(r.accel)}`}>{pct(r.accel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grow" />
        </div>

        {/* Right column, row 1: Profitability */}
        <div className="rounded-xl border p-4 bg-white">
          <div className="flex items-center gap-2 mb-2"><Gauge className="w-4 h-4"/><div className="font-semibold">Profitability</div></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-sm flex justify-between">
              <span className="text-muted-foreground">EBITDA margin</span>
              <span className="font-medium">{pct(safeDiv(latestFY?.EBITDA, latestFY?.revenue))}</span>
            </div>
            <div className="text-sm flex justify-between">
              <span className="text-muted-foreground">Net margin</span>
              <span className="font-medium">{pct(latestFY?.netMargin)}</span>
            </div>
            <div className="text-sm flex justify-between">
              <span className="text-muted-foreground">Operating leverage</span>
              <span className="font-medium">{pct(latestFY?.operating_leverage_ratio)}</span>
            </div>
          </div>
        </div>

        {/* Right column, row 2: Quarterly Momentum */}
        <div className="rounded-xl border p-4 bg-white">
          <div className="flex items-center gap-2 mb-2"><Activity className="w-4 h-4"/><div className="font-semibold">Quarterly Momentum</div></div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-sm flex justify-between">
              <span className="text-muted-foreground">Rev QoQ</span>
              <span className="font-medium">{pct(latestQ?.revenue_growth_qoq)}</span>
            </div>
            <div className="text-sm flex justify-between">
              <span className="text-muted-foreground">NI QoQ</span>
              <span className="font-medium">{pct(latestQ?.net_income_growth_qoq)}</span>
            </div>
            <div className="text-sm flex justify-between">
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
function FYTab({ FY, latestFY }) {
  return (
    <div className="space-y-6">
      {/* Growth & Duration vs Accel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border p-4 bg-white">
          <Section title="Growth & Duration (Latest FY)" icon={TrendingUp} />
          <div className="grid grid-cols-3 gap-3">
            <KPI label="Revenue YoY" value={latestFY?.revenue_growth_yoy} />
            <KPI label="Net Income YoY" value={latestFY?.net_income_growth_yoy} />
            <KPI label="FCF YoY" value={latestFY?.fcf_growth_yoy} />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <KPI label="3Y Rev CAGR" value={latestFY?.revenue_cagr_3y} />
            <KPI label="3Y NI CAGR" value={latestFY?.net_income_cagr_3y} />
            <KPI label="3Y FCF CAGR" value={latestFY?.fcf_cagr_3y} />
          </div>
        </div>
        <div className="rounded-xl border p-4 bg-white">
          <Section title="Acceleration (YoY)" icon={Activity} />
          <div className="flex flex-wrap gap-2">
            <Chip label="Rev accel YoY" value={latestFY?.revenue_growth_accel_yoy} />
            <Chip label="NI accel YoY" value={latestFY?.net_income_growth_accel_yoy} />
            <Chip label="FCF accel YoY" value={latestFY?.fcf_growth_accel_yoy} />
          </div>
        </div>
      </div>

      {/* Trend charts */}
      <div className="rounded-xl border p-4 bg-white">
        <Section title="Revenue vs Net Income (Levels)" icon={TrendingUp} />
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={FY} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis yAxisId="left" tickFormatter={fmt} fontSize={12} />
              <Tooltip formatter={(v, n)=> n.includes('YoY') ? pct(v) : fmt(v)} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="netIncome" name="Net Income" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border p-4 bg-white">
        <Section title="Free Cash Flow (Level)" icon={PiggyBank} />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={FY} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis tickFormatter={fmt} fontSize={12} />
              <Tooltip formatter={(v)=>fmt(v)} />
              <Legend />
              <Line type="monotone" dataKey="freeCashFlow" name="FCF" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border p-4 bg-white">
        <Section title="YoY Growth (Rev / NI / FCF)" icon={TrendingUp} />
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={FY} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} fontSize={12} />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Line type="monotone" dataKey="revenue_growth_yoy" name="Rev YoY" dot={false} />
              <Line type="monotone" dataKey="net_income_growth_yoy" name="NI YoY" dot={false} />
              <Line type="monotone" dataKey="fcf_growth_yoy" name="FCF YoY" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Profitability & Leverage */}
      <div className="rounded-xl border p-4 bg-white">
        <Section title="Profitability & Leverage" icon={Gauge} />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-2">
            <Row label="Gross margin" value={pct(latestFY?.grossMargin)} />
            <Row label="Operating margin" value={pct(latestFY?.operatingMargin)} />
            <Row label="Net margin" value={pct(latestFY?.netMargin)} />
          </div>
          <div className="space-y-2">
            <Row label="EBITDA (latest)" value={fmt(latestFY?.EBITDA)} />
            <Row label="EBITDA margin" value={pct(safeDiv(latestFY?.EBITDA, latestFY?.revenue))} />
            <Row label="Operating leverage (latest)" value={pct(latestFY?.operating_leverage_ratio)} />
          </div>
        </div>
      </div>

      {/* Flags */}
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
function QuarterlyTab({ Q, latestQ }) {
  return (
    <div className="space-y-6">
      {/* Momentum KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border p-4 bg-white">
          <Section title="Momentum (QoQ)" icon={Activity} />
          <div className="grid grid-cols-3 gap-3">
            <KPI label="Rev QoQ" value={latestQ?.revenue_growth_qoq} />
            <KPI label="NI QoQ" value={latestQ?.net_income_growth_qoq} />
            <KPI label="FCF QoQ" value={latestQ?.fcf_growth_qoq} />
          </div>
        </div>
        <div className="rounded-xl border p-4 bg-white">
          <Section title="Momentum (YoY)" icon={TrendingUp} />
          <div className="grid grid-cols-3 gap-3">
            <KPI label="Rev YoY" value={latestQ?.revenue_growth_yoy} />
            <KPI label="NI YoY" value={latestQ?.net_income_growth_yoy} />
            <KPI label="FCF YoY" value={latestQ?.fcf_growth_yoy} />
          </div>
        </div>
      </div>

      {/* Acceleration grid */}
      <div className="rounded-xl border p-4 bg-white">
        <Section title="Acceleration (YoY & QoQ)" icon={Activity} />
        <div className="flex flex-wrap gap-2">
          <Chip label="Rev accel YoY" value={latestQ?.revenue_growth_accel_yoy} />
          <Chip label="NI accel YoY" value={latestQ?.net_income_growth_accel_yoy} />
          <Chip label="FCF accel YoY" value={latestQ?.fcf_growth_accel_yoy} />
          <Chip label="Rev accel QoQ" value={latestQ?.revenue_growth_accel_qoq} />
          <Chip label="NI accel QoQ" value={latestQ?.net_income_growth_accel_qoq} />
          <Chip label="FCF accel QoQ" value={latestQ?.fcf_growth_accel_qoq} />
        </div>
      </div>

      {/* Momentum charts */}
      <div className="rounded-xl border p-4 bg-white">
        <Section title="QoQ Growth (Rev / NI / FCF)" icon={Activity} />
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={Q} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} fontSize={12} />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Line type="monotone" dataKey="revenue_growth_qoq" name="Rev QoQ" dot={false} />
              <Line type="monotone" dataKey="net_income_growth_qoq" name="NI QoQ" dot={false} />
              <Line type="monotone" dataKey="fcf_growth_qoq" name="FCF QoQ" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border p-4 bg-white">
        <Section title="YoY Growth (Rev / NI / FCF)" icon={TrendingUp} />
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={Q} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} fontSize={12} />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Line type="monotone" dataKey="revenue_growth_yoy" name="Rev YoY" dot={false} />
              <Line type="monotone" dataKey="net_income_growth_yoy" name="NI YoY" dot={false} />
              <Line type="monotone" dataKey="fcf_growth_yoy" name="FCF YoY" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Quarterly margins */}
      <div className="rounded-xl border p-4 bg-white">
        <Section title="Quarterly Margins" icon={Gauge} />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={Q.slice(-12)} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis tickFormatter={(v)=>`${(v*100).toFixed(0)}%`} fontSize={12} />
              <Tooltip formatter={(v)=>pct(v)} />
              <Legend />
              <Line type="monotone" dataKey="grossMargin" name="Gross" dot={false} />
              <Line type="monotone" dataKey="operatingMargin" name="Operating" dot={false} />
              <Line type="monotone" dataKey="netMargin" name="Net" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default function ClientFundamentals() {
  const [bundle, setBundle] = useState([])
  const [symbol, setSymbol] = useState('')
  const [tab, setTab] = useState('Overview')

  useEffect(() => {
    let isMounted = true
    fetch('/data/fundamentals_highlights.json', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (isMounted) { setBundle(j || []); if (j?.[0]?.symbol) setSymbol(j[0].symbol) } })
      .catch(() => {})
    return () => { isMounted = false }
  }, [])

  const record = useMemo(() => bundle.find(r => r.symbol === symbol), [bundle, symbol])
  const FY = useMemo(() => sortByDate(record?.FY || []), [record])
  const Q = useMemo(() => sortByDate(record?.Q || []), [record])
  const latestFY = safeLatest(FY)
  const latestQ = safeLatest(Q)

  const ebitdaMargin = useMemo(() => {
    const e = Number(latestFY?.EBITDA ?? NaN)
    const rev = Number(latestFY?.revenue ?? NaN)
    if (!isFinite(e) || !isFinite(rev) || rev === 0) return null
    return e / rev
  }, [latestFY])

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <select className="border rounded-md px-3 py-2" value={symbol} onChange={e => setSymbol(e.target.value)}>
          {bundle.map(r => (
            <option key={r.symbol} value={r.symbol}>{r.symbol}</option>
          ))}
        </select>
        <div className="flex gap-2">
          {['Overview','FY','Quarterly'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 rounded-md border ${tab===t ? 'bg-black text-white' : 'bg-white'}`}>{t}</button>
          ))}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <SummaryCard title="Revenue YoY" icon={TrendingUp} value={tab==='Quarterly' ? latestQ?.revenue_growth_yoy : latestFY?.revenue_growth_yoy} fmt={pct} />
        <SummaryCard title="Net Income YoY" icon={TrendingUp} value={tab==='Quarterly' ? latestQ?.net_income_growth_yoy : latestFY?.net_income_growth_yoy} fmt={pct} />
        <SummaryCard title="FCF YoY" icon={TrendingUp} value={tab==='Quarterly' ? latestQ?.fcf_growth_yoy : latestFY?.fcf_growth_yoy} fmt={pct} />
        <SummaryCard title="EBITDA (lvl)" icon={PiggyBank} value={latestFY?.EBITDA} fmt={fmt} sub={`EBITDA margin: ${pct(ebitdaMargin)}`} />
      </div>

      {tab === 'Overview' && (
        <OverviewTab latestFY={latestFY} latestQ={latestQ} />
      )}

      {tab === 'FY' && (
        <FYTab FY={FY} latestFY={latestFY} />
      )}

      {tab === 'Quarterly' && (
        <QuarterlyTab Q={Q} latestQ={latestQ} />
      )}
    </div>
  )
}
