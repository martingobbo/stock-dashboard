// app/fundamental_screener/page.js
// Server Component — shows two filter tables (Growth & Efficiency) using fundamentals_highlights.json

import 'server-only'
import fs from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ============================ CONFIG ============================ */
// Thresholds (edit here if you want to tweak filters)
const GROWTH_THRESHOLDS = {
  roe_yoy_delta: 0.10,       // > +10 percentage points YoY (i.e., +0.10)
  revenue_growth_yoy: 0.05,  // > +5%
  fcf_cagr_3y: 0.05,         // > +5%
}

const EFFICIENCY_THRESHOLDS = {
  roa: 0.15,        // > 15%
  roe: 0.30,        // > 30%
  netMargin: 0.15,  // > 15%
}

/* ============================ HELPERS ============================ */
function parseDateSafe(d) {
  // fundamentals_highlights stores ISO "YYYY-MM-DD"
  // fall back to string compare if Date parsing fails (but it shouldn't)
  const t = Date.parse(d)
  return Number.isNaN(t) ? d : t
}

function sortByDateAsc(rows) {
  return [...(rows || [])].filter(r => r?.date).sort((a, b) => {
    const da = parseDateSafe(a.date)
    const db = parseDateSafe(b.date)
    return da < db ? -1 : da > db ? 1 : 0
  })
}

function latestAndPrevFY(record) {
  const fy = sortByDateAsc(record?.FY || [])
  if (!fy.length) return { latest: null, prev: null }
  const latest = fy[fy.length - 1]
  const prev = fy.length > 1 ? fy[fy.length - 2] : null
  return { latest, prev }
}

function pct(x) {
  if (x === null || x === undefined) return '—'
  return `${(x * 100).toFixed(1)}%`
}

function num(x, digits = 2) {
  if (x === null || x === undefined) return '—'
  return Number(x).toFixed(digits)
}

/**
 * ROE YoY ">" 10%:
 * We interpret this as a +10 percentage-point delta vs prior FY:
 * (ROE_latest - ROE_prev) > 0.10
 */
function roeYoYDelta(latest, prev) {
  if (!latest || !prev) return null
  const r = (latest.ROE ?? null)
  const p = (prev.ROE ?? null)
  if (r === null || p === null) return null
  return r - p
}

function passesGrowthFilter(latest, prev) {
  if (!latest) return false
  const deltaROE = roeYoYDelta(latest, prev)
  const revYoY = latest.revenue_growth_yoy ?? null
  const fcfCagr = latest.fcf_cagr_3y ?? null

  const cond1 = (deltaROE !== null) && (deltaROE > GROWTH_THRESHOLDS.roe_yoy_delta)
  const cond2 = (revYoY !== null) && (revYoY > GROWTH_THRESHOLDS.revenue_growth_yoy)
  const cond3 = (fcfCagr !== null) && (fcfCagr > GROWTH_THRESHOLDS.fcf_cagr_3y)

  return cond1 && cond2 && cond3
}

function passesEfficiencyFilter(latest) {
  if (!latest) return false
  const roa = latest.ROA ?? null
  const roe = latest.ROE ?? null
  const nm  = latest.netMargin ?? null

  const c1 = (roa !== null) && (roa > EFFICIENCY_THRESHOLDS.roa)
  const c2 = (roe !== null) && (roe > EFFICIENCY_THRESHOLDS.roe)
  const c3 = (nm  !== null) && (nm  > EFFICIENCY_THRESHOLDS.netMargin)

  return c1 && c2 && c3
}

/* ============================ DATA LOAD ============================ */
async function loadFundamentals() {
  const file = path.join(process.cwd(), 'public', 'data', 'fundamentals_highlights.json')
  const raw = await fs.readFile(file, 'utf8')
  return JSON.parse(raw) // [{ symbol, FY: [...], Q: [...] }, ...]
}

/* ============================ UI ============================ */
function Section({ title, children, subtitle }) {
  return (
    <section className="mb-10">
      <div className="mb-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle ? <p className="text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      <div className="rounded-2xl border p-3 shadow-sm">{children}</div>
    </section>
  )
}

function Table({ columns, rows, emptyText = 'No matches' }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-medium text-gray-700">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-4 text-center text-gray-500">
                {emptyText}
              </td>
            </tr>
          ) : rows.map((r) => (
            <tr key={r._id} className="border-t">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2 align-top">{r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============================ PAGE ============================ */
export default async function FundamentalScreenerPage() {
  const bundle = await loadFundamentals()

  // Build model rows
  const growthRows = []
  const efficiencyRows = []

  for (const rec of bundle) {
    const { latest, prev } = latestAndPrevFY(rec)
    if (!latest) continue

    // Pre-format values for display
    const symbol = rec.symbol

    // Values used in Growth filter
    const roeDelta = roeYoYDelta(latest, prev)
    const revYoY = latest.revenue_growth_yoy ?? null
    const fcfCagr = latest.fcf_cagr_3y ?? null

    // Values used in Efficiency filter
    const roa = latest.ROA ?? null
    const roe = latest.ROE ?? null
    const netMargin = latest.netMargin ?? null

    // If passes Growth filter
    if (passesGrowthFilter(latest, prev)) {
      growthRows.push({
        _id: `growth-${symbol}`,
        symbol,
        roe_yoy_delta: pct(roeDelta),
        revenue_growth_yoy: pct(revYoY),
        fcf_cagr_3y: pct(fcfCagr),
        // Optional: show dates to make it clear which FY we used
        as_of: latest.date || '—',
      })
    }

    // If passes Efficiency filter
    if (passesEfficiencyFilter(latest)) {
      efficiencyRows.push({
        _id: `eff-${symbol}`,
        symbol,
        roa: pct(roa),
        roe: pct(roe),
        net_margin: pct(netMargin),
        as_of: latest.date || '—',
      })
    }
  }

  // Sort rows (optional): sort Growth by highest Rev YoY, Efficiency by highest ROE
  growthRows.sort((a, b) => {
    const av = parseFloat(a.revenue_growth_yoy === '—' ? '-999' : a.revenue_growth_yoy)
    const bv = parseFloat(b.revenue_growth_yoy === '—' ? '-999' : b.revenue_growth_yoy)
    return isNaN(bv - av) ? 0 : (bv - av)
  })
  efficiencyRows.sort((a, b) => {
    const av = parseFloat(a.roe === '—' ? '-999' : a.roe)
    const bv = parseFloat(b.roe === '—' ? '-999' : b.roe)
    return isNaN(bv - av) ? 0 : (bv - av)
  })

  const growthColumns = [
    { key: 'symbol', header: 'Symbol' },
    { key: 'roe_yoy_delta', header: 'ROE YoY Δ' },
    { key: 'revenue_growth_yoy', header: 'Revenue YoY' },
    { key: 'fcf_cagr_3y', header: '3Y FCF CAGR' },
    { key: 'as_of', header: 'As of (FY)' },
  ]

  const efficiencyColumns = [
    { key: 'symbol', header: 'Symbol' },
    { key: 'roa', header: 'ROA' },
    { key: 'roe', header: 'ROE' },
    { key: 'net_margin', header: 'Net Margin' },
    { key: 'as_of', header: 'As of (FY)' },
  ]

  return (
    <main className="mx-auto max-w-7xl p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Fundamental Screener</h1>
        <p className="text-sm text-gray-600">
          Using <code>public/data/fundamentals_highlights.json</code> (latest FY row per symbol). Thresholds are editable at the top of this file.
        </p>
      </header>

      <Section
        title="Table 1: Growth Filter"
        subtitle="ROE YoY Δ > 10pp, Revenue YoY > 5%, 3Y FCF CAGR > 5%"
      >
        <Table columns={growthColumns} rows={growthRows} emptyText="No symbols match the Growth criteria." />
      </Section>

      <Section
        title="Table 2: Efficiency Filter"
        subtitle="ROA > 15%, ROE > 30%, Net Margin > 15%"
      >
        <Table columns={efficiencyColumns} rows={efficiencyRows} emptyText="No symbols match the Efficiency criteria." />
      </Section>
    </main>
  )
}
