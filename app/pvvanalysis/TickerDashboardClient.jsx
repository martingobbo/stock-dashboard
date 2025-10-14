// app/ticker/TickerDashboardClient.jsx
'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

// Preserve DB calendar date (often midnight UTC) without TZ shift.
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

const TF = [
  { key: '5d',  label: '5D', days: 5 },
  { key: '10d', label: '10D', days: 10 },
  { key: '1m',  label: '1M', days: 30 },
  { key: '3m',  label: '3M', days: 90 },
  { key: '6m',  label: '6M', days: 180 },
  { key: '1y',  label: '1Y', days: 365 },
  { key: '3y',  label: '3Y', days: 365 * 3 },
  { key: '5y',  label: '5Y', days: 365 * 5 },
]

function formatUSD(n) {
  if (n == null || isNaN(n)) return '-'
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (Math.abs(n) >= 1e9)  return (n / 1e9 ).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6)  return (n / 1e6 ).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3)  return (n / 1e3 ).toFixed(2) + 'K'
  return String(n)
}
function formatPct(x) {
  if (x == null || !isFinite(x)) return '—'
  const pct = x * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

export default function TickerDashboardClient(props) {
  const { mode } = props
  if (mode === 'header-controls') return <HeaderControls {...props} />
  return <Content {...props} />
}

function HeaderControls({ allTickers, selectedTicker }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname() || '/ticker'

  function onChange(e) {
    const t = e.target.value
    if (!t || t === selectedTicker) return
    const sp = new URLSearchParams(searchParams.toString())
    sp.set('t', t)
    router.push(`${pathname}?${sp.toString()}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="ticker-select" className="text-sm text-gray-600">Ticker</label>
      <select
        id="ticker-select"
        value={selectedTicker}
        onChange={onChange}
        className="border rounded-lg px-3 py-2 text-sm"
      >
        {allTickers.map((r) => (
          <option key={r.ticker} value={r.ticker}>
            {r.ticker}{r.name && r.name !== r.ticker ? ` — ${r.name}` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

function Content({ selectedTicker, priceRows, metricRows, latestMetricDate }) {
  const [tfKey, setTfKey] = useState('6m')
  const [metricsOpen, setMetricsOpen] = useState(false)

  // Normalize for chart
  const chartDataAll = useMemo(() => {
    return (priceRows || []).map(r => ({
      date: toYMD(r.dt),
      adj_close: Number(r.adj_close),
      volume: r.volume != null ? Number(r.volume) : null,
    }))
  }, [priceRows])

  // Filter by timeframe using simple tail-slice
  const chartData = useMemo(() => {
    if (!chartDataAll.length) return []
    const tf = TF.find(t => t.key === tfKey) || TF[4] // default 6M
    return chartDataAll.slice(-tf.days)
  }, [chartDataAll, tfKey])

  const cumReturn = useMemo(() => {
    if (!chartData.length) return null
    const first = chartData[0]?.adj_close
    const last = chartData[chartData.length - 1]?.adj_close
    if (first == null || last == null || !isFinite(first) || first === 0) return null
    return (last / first) - 1
  }, [chartData])

  const metricsSorted = useMemo(() => {
    const rows = (metricRows || []).map(r => ({
      metric_code: r.metric_code,
      value: r.value,
      date: toYMD(r.date)
    }))
    rows.sort((a, b) => a.metric_code.localeCompare(b.metric_code))
    return rows
  }, [metricRows])

  const tfLabel = useMemo(() => (TF.find(t => t.key === tfKey)?.label ?? '6M'), [tfKey])
  const latestAsOf = useMemo(() => toYMD(latestMetricDate) || '', [latestMetricDate])

  return (
    <div className="flex flex-col gap-8">
      <div className="border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            {selectedTicker} · Adjusted Close
          </h2>
          <div className="flex flex-wrap gap-2">
            {TF.map(t => (
              <button
                key={t.key}
                onClick={() => setTfKey(t.key)}
                className={`px-3 py-1.5 text-sm rounded-lg border ${
                  tfKey === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative w-full h-80">
          <div className="absolute top-2 right-2 z-10">
            <div className="rounded-lg border px-3 py-1.5 text-sm bg-white/90 backdrop-blur">
              <span className="text-gray-600 mr-2">Cumulative {tfLabel}:</span>
              <span className={cumReturn > 0 ? 'text-green-600 font-semibold' : (cumReturn < 0 ? 'text-red-600 font-semibold' : 'text-gray-800 font-semibold')}>
                {formatPct(cumReturn)}
              </span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} minTickGap={24} />
              <YAxis tick={{ fontSize: 12 }} domain={['auto', 'auto']} />
              <Tooltip
                formatter={(val, name) => {
                  if (name === 'adj_close') return [Number(val).toFixed(2), 'Adj Close']
                  if (name === 'volume') return [formatUSD(val), 'Volume']
                  return [val, name]
                }}
                labelFormatter={(label) => label} // do not reparse dates
              />
              <Line type="monotone" dataKey="adj_close" dot={false} strokeWidth={1.8} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Collapsible Latest Metrics */}
      <div className="border rounded-xl">
        <button
          type="button"
          onClick={() => setMetricsOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <div className="text-xs text-gray-600">
            Latest metrics {latestAsOf ? <span>· <span className="font-medium">{latestAsOf}</span></span> : null}
          </div>
          <div className="text-xs text-gray-500">{metricsOpen ? 'Hide' : 'Show'}</div>
        </button>

        {metricsOpen && (
          <div className="px-4 pb-4">
            {metricsSorted.length === 0 ? (
              <div className="text-sm text-gray-500">No snapshot metrics found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-700 border-b">Metric</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-700 border-b">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsSorted.map((m) => (
                      <tr key={m.metric_code} className="odd:bg-white even:bg-gray-50">
                        <td className="px-3 py-2 border-b">{m.metric_code}</td>
                        <td className="px-3 py-2 border-b">{m.value ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
