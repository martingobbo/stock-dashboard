import 'server-only'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { notFound } from 'next/navigation'

async function queryDuckDB(sql) {
  const duckdb = (await import('duckdb')).default
  const dbPath = '/Users/martingobbo/stock-dashboard/data/serving/analytics.duckdb'
  const db = new duckdb.Database(dbPath)
  const conn = db.connect()
  try {
    return conn.all(sql)
  } finally {
    await conn.close()
  }
}

function toSqlLiteral(s) {
  return `'${String(s || '').trim().toUpperCase().replace(/'/g, "''")}'`
}

async function getWeeklyHighLow(ticker) {
  const sql = `
    WITH chosen AS (
      SELECT t.ticker_id, t.ticker
      FROM dim_ticker t
      WHERE t.ticker = ${toSqlLiteral(ticker)}
    ),
    recent AS (
      SELECT
        f.dt,
        f.open, f.high, f.low, f.close, f.adj_close, f.volume,
        ROW_NUMBER() OVER (ORDER BY f.dt DESC) AS rn
      FROM fact_price_daily f
      JOIN chosen c USING (ticker_id)
      ORDER BY f.dt DESC
      LIMIT 20
    ),
    bucketed AS (
      SELECT
        dt,
        high,
        low,
        CAST(CEIL(rn / 5.0) AS INTEGER) AS week_idx_desc
      FROM recent
    )
    SELECT
      5 - week_idx_desc AS week_idx,
      min(low) AS weekly_low,
      max(high) AS weekly_high,
      max(dt) AS week_end_dt,
      min(dt) AS week_start_dt
    FROM bucketed
    GROUP BY week_idx_desc
    ORDER BY week_idx;
  `
  const rows = await queryDuckDB(sql)
  if (!rows?.length) return null
  return rows.map(r => ({
    week_idx: Number(r.week_idx),
    low: Number(r.weekly_low),
    high: Number(r.weekly_high),
    week_start_dt: String(r.week_start_dt),
    week_end_dt: String(r.week_end_dt)
  }))
}

function HiLoSvg({ data }) {
  const width = 720
  const height = 320
  const pad = 36
  const lows = data.map(d => d.low)
  const highs = data.map(d => d.high)
  const yMin = Math.min(...lows)
  const yMax = Math.max(...highs)
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const n = data.length
  const xStep = innerW / (n + 1)
  const y = val => pad + (yMax - val) * (innerH / (yMax - yMin || 1))
  const x = i => pad + xStep * (i + 1)
  const tickLen = 8

  const yTicks = 5
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i * (yMax - yMin)) / yTicks)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto border rounded-2xl shadow">
      <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="currentColor" strokeWidth={1} />
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="currentColor" strokeWidth={1} />

      {yVals.map((v, i) => (
        <g key={i}>
          <line x1={pad - 4} x2={pad} y1={y(v)} y2={y(v)} stroke="currentColor" strokeWidth={1} />
          <text x={pad - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" className="text-xs fill-current">
            {v.toFixed(2)}
          </text>
          <line x1={pad} x2={width - pad} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.08} />
        </g>
      ))}

      {data.map((d, i) => (
        <g key={d.week_idx}>
          <line x1={x(i)} x2={x(i)} y1={y(d.low)} y2={y(d.high)} stroke="currentColor" strokeWidth={2} />
          <line x1={x(i) - tickLen / 2} x2={x(i) + tickLen / 2} y1={y(d.low)} y2={y(d.low)} stroke="currentColor" strokeWidth={2} />
          <line x1={x(i) - tickLen / 2} x2={x(i) + tickLen / 2} y1={y(d.high)} y2={y(d.high)} stroke="currentColor" strokeWidth={2} />
          <text x={x(i)} y={height - pad + 14} textAnchor="middle" className="text-xs fill-current">
            W{d.week_idx}
          </text>
        </g>
      ))}

      <text x={width / 2} y={20} textAnchor="middle" className="text-sm font-medium fill-current">
        Weekly High–Low (4 most recent weeks)
      </text>
    </svg>
  )
}

export default async function Page({ params, searchParams }) {
  const ticker = (params?.ticker || String(searchParams?.ticker || 'AAPL')).toUpperCase()
  const data = await getWeeklyHighLow(ticker)
  if (!data) return notFound()

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{ticker} — Weekly High/Low</h1>
        <Link href="/" className="text-sm underline">← Home</Link>
      </div>

      <p className="text-sm text-muted-foreground">
        Last 20 trading days → 4 buckets (5 days each). Each shows min(low) and max(high).
      </p>

      <HiLoSvg data={data} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm border rounded-2xl">
          <thead>
            <tr className="bg-muted/40 text-left">
              <th className="p-2">Week</th>
              <th className="p-2">Start</th>
              <th className="p-2">End</th>
              <th className="p-2">Low</th>
              <th className="p-2">High</th>
            </tr>
          </thead>
          <tbody>
            {data.map(d => (
              <tr key={d.week_idx} className="border-t">
                <td className="p-2">W{d.week_idx}</td>
                <td className="p-2">{d.week_start_dt}</td>
                <td className="p-2">{d.week_end_dt}</td>
                <td className="p-2">{d.low.toFixed(2)}</td>
                <td className="p-2">{d.high.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
