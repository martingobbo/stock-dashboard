// app/sector/[slug]/page.js
import 'server-only'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import Link from 'next/link'
import PrintButton from '../components/PrintButton'

const DB_PATH = '/Users/martingobbo/stock-dashboard/data/serving/analytics.duckdb'

/* ------------------- Hard-coded sector & subsector codes ------------------- */
const SECTOR_CODE = {
  'basic-materials': 'sector_basic_materials',
  'communication-services': 'sector_communication_services',
  'consumer-cyclical': 'sector_consumer_cyclical',
  'consumer-defensive': 'sector_consumer_defensive',
  'energy': 'sector_energy',
  'financial-services': 'sector_financial_services',
  'healthcare': 'sector_healthcare',
  'industrials': 'sector_industrials',
  'real-estate': 'sector_real_estate',
  'technology': 'sector_technology',
  'utilities': 'sector_utilities',
}

const ALL_SUBSECTOR_CODES = [
  'subsector_advertising_agencies_communication_services',
  'subsector_aerospace_defense_industrials',
  'subsector_agricultural_farm_products_consumer_defensive',
  'subsector_agricultural_inputs_basic_materials',
  'subsector_agricultural_machinery_industrials',
  'subsector_airlines_airports_air_services_industrials',
  'subsector_apparel_footwear_accessories_consumer_cyclical',
  'subsector_apparel_manufacturers_consumer_cyclical',
  'subsector_apparel_retail_consumer_cyclical',
  'subsector_asset_management_financial_services',
  'subsector_asset_management_global_financial_services',
  'subsector_auto_dealerships_consumer_cyclical',
  'subsector_auto_manufacturers_consumer_cyclical',
  'subsector_auto_parts_consumer_cyclical',
  'subsector_banks_diversified_financial_services',
  'subsector_banks_regional_financial_services',
  'subsector_beverages_alcoholic_consumer_defensive',
  'subsector_beverages_non_alcoholic_consumer_defensive',
  'subsector_beverages_wineries_distilleries_consumer_defensive',
  'subsector_biotechnology_healthcare',
  'subsector_business_equipment_supplies_industrials',
  'subsector_chemicals_basic_materials',
  'subsector_chemicals_specialty_basic_materials',
  'subsector_communication_equipment_technology',
  'subsector_computer_hardware_technology',
  'subsector_conglomerates_industrials',
  'subsector_construction_industrials',
  'subsector_construction_materials_basic_materials',
  'subsector_consulting_services_industrials',
  'subsector_consumer_electronics_technology',
  'subsector_copper_basic_materials',
  'subsector_discount_stores_consumer_defensive',
  'subsector_diversified_utilities_utilities',
  'subsector_drug_manufacturers_general_healthcare',
  'subsector_drug_manufacturers_specialty_generic_healthcare',
  'subsector_electrical_equipment_parts_industrials',
  'subsector_electronic_gaming_multimedia_technology',
  'subsector_engineering_construction_industrials',
  'subsector_entertainment_communication_services',
  'subsector_financial_capital_markets_financial_services',
  'subsector_financial_credit_services_financial_services',
  'subsector_financial_data_stock_exchanges_financial_services',
  'subsector_food_confectioners_consumer_defensive',
  'subsector_food_distribution_consumer_defensive',
  'subsector_furnishings_fixtures_appliances_consumer_cyclical',
  'subsector_gambling_resorts_casinos_consumer_cyclical',
  'subsector_general_utilities_utilities',
  'subsector_gold_basic_materials',
  'subsector_grocery_stores_consumer_defensive',
  'subsector_hardware_equipment_parts_technology',
  'subsector_home_improvement_consumer_cyclical',
  'subsector_household_personal_products_consumer_defensive',
  'subsector_independent_power_producers_utilities',
  'subsector_industrial_distribution_industrials',
  'subsector_industrial_machinery_industrials',
  'subsector_industrial_pollution_treatment_controls_industrials',
  'subsector_information_technology_services_technology',
  'subsector_insurance_brokers_financial_services',
  'subsector_insurance_diversified_financial_services',
  'subsector_insurance_life_financial_services',
  'subsector_insurance_property_casualty_financial_services',
  'subsector_insurance_reinsurance_financial_services',
  'subsector_insurance_specialty_financial_services',
  'subsector_integrated_freight_logistics_industrials',
  'subsector_internet_content_information_communication_services',
  'subsector_investment_banking_investment_services_financial_services',
  'subsector_leisure_consumer_cyclical',
  'subsector_luxury_goods_consumer_cyclical',
  'subsector_manufacturing_tools_accessories_industrials',
  'subsector_medical_care_facilities_healthcare',
  'subsector_medical_devices_healthcare',
  'subsector_medical_diagnostics_research_healthcare',
  'subsector_medical_distribution_healthcare',
  'subsector_medical_equipment_services_healthcare',
  'subsector_medical_healthcare_information_services_healthcare',
  'subsector_medical_healthcare_plans_healthcare',
  'subsector_medical_instruments_supplies_healthcare',
  'subsector_oil_gas_equipment_services_energy',
  'subsector_oil_gas_exploration_production_energy',
  'subsector_oil_gas_integrated_energy',
  'subsector_oil_gas_midstream_energy',
  'subsector_oil_gas_refining_marketing_energy',
  'subsector_packaged_foods_consumer_defensive',
  'subsector_packaging_containers_consumer_cyclical',
  'subsector_personal_products_services_consumer_cyclical',
  'subsector_railroads_industrials',
  'subsector_real_estate_services_real_estate',
  'subsector_regulated_electric_utilities',
  'subsector_regulated_gas_utilities',
  'subsector_regulated_water_utilities',
  'subsector_reit_diversified_real_estate',
  'subsector_reit_healthcare_facilities_real_estate',
  'subsector_reit_hotel_motel_real_estate',
  'subsector_reit_industrial_real_estate',
  'subsector_reit_office_real_estate',
  'subsector_reit_residential_real_estate',
  'subsector_reit_retail_real_estate',
  'subsector_reit_specialty_real_estate',
  'subsector_renewable_utilities_utilities',
  'subsector_rental_leasing_services_industrials',
  'subsector_residential_construction_consumer_cyclical',
  'subsector_restaurants_consumer_cyclical',
  'subsector_security_protection_services_industrials',
  'subsector_semiconductors_technology',
  'subsector_software_application_technology',
  'subsector_software_infrastructure_technology',
  'subsector_software_services_technology',
  'subsector_solar_energy',
  'subsector_specialty_business_services_industrials',
  'subsector_specialty_retail_consumer_cyclical',
  'subsector_staffing_employment_services_industrials',
  'subsector_steel_basic_materials',
  'subsector_telecommunications_services_communication_services',
  'subsector_tobacco_consumer_defensive',
  'subsector_travel_lodging_consumer_cyclical',
  'subsector_travel_services_consumer_cyclical',
  'subsector_trucking_industrials',
  'subsector_waste_management_industrials',
]

const SUBSECTOR_EXTRAS_BY_SECTOR = {
  energy: ['subsector_solar_energy'],
}

/* ------------------------------ Helpers ------------------------------ */
const esc = (s) => String(s).replaceAll("'", "''")
function sqlInList(strs) { return strs.map(s => `'${esc(s)}'`).join(', ') }
function fmtCap(n) {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (a >= 1e9)  return (n / 1e9).toFixed(2) + 'B'
  if (a >= 1e6)  return (n / 1e6).toFixed(2) + 'M'
  return Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
}
function fmtPct(n, dp = 2) { return (n == null || Number.isNaN(n)) ? '—' : (n * 100).toFixed(dp) + '%' }
function titleFromSlug(slugText) { return slugText.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) }

/* ---------------- Subsector performance & market-cap (top table) ------------------ */
async function getSubsectorCaps(slug) {
  const slugSafe = String(slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const sectorCode = SECTOR_CODE[slugSafe]
  if (!sectorCode) return { dt: null, sector: null, subsectors: [], error: 'Unknown sector slug' }

  const sectorUnderscore = sectorCode.replace(/^sector_/, '')
  const extras = SUBSECTOR_EXTRAS_BY_SECTOR[sectorUnderscore] ?? []
  const subsForSector = ALL_SUBSECTOR_CODES.filter(c => c.endsWith(`_${sectorUnderscore}`)).concat(extras)

  const duckdb = (await import('duckdb')).default
  const db = new duckdb.Database(DB_PATH)
  const con = db.connect()

  try {
    const pList = [...subsForSector, sectorCode]
    const inList = sqlInList(pList)
    const suffixPattern = `_${esc(sectorUnderscore)}$`

    const sql = `
      WITH base AS (
        SELECT LOWER(dp.portfolio_code) AS pcode, CAST(f.dt AS DATE) AS dt, SUM(f.market_value) AS mv
        FROM fact_portfolio_daily f
        JOIN dim_portfolio dp USING (portfolio_id)
        WHERE LOWER(dp.portfolio_code) IN (${inList})
        GROUP BY 1,2
      ),
      ranked AS (
        SELECT pcode, dt, mv,
               ROW_NUMBER() OVER (PARTITION BY pcode ORDER BY dt DESC) AS rn,
               (mv / LAG(mv) OVER (PARTITION BY pcode ORDER BY dt) - 1) AS daily_ret
        FROM base
      ),
      points AS (
        SELECT pcode,
               MAX(CASE WHEN rn = 1   THEN mv END) AS mv_latest,
               MAX(CASE WHEN rn = 5   THEN mv END) AS mv_5,
               MAX(CASE WHEN rn = 20  THEN mv END) AS mv_20,
               MAX(CASE WHEN rn = 60  THEN mv END) AS mv_60,
               MAX(CASE WHEN rn = 120 THEN mv END) AS mv_120,
               MAX(CASE WHEN rn = 252 THEN mv END) AS mv_252
        FROM ranked GROUP BY pcode
      ),
      vol AS (
        SELECT pcode, STDDEV_SAMP(daily_ret) FILTER (WHERE rn <= 60 AND daily_ret IS NOT NULL) AS vol_60d
        FROM ranked GROUP BY pcode
      ),
      latest_dt AS (SELECT MAX(dt) AS max_dt FROM base),
      joined AS (
        SELECT p.pcode, p.mv_latest, p.mv_5, p.mv_20, p.mv_60, p.mv_120, p.mv_252, v.vol_60d,
               (CASE WHEN p.mv_latest IS NOT NULL AND p.mv_5   IS NOT NULL AND p.mv_5  > 0 THEN p.mv_latest / p.mv_5   - 1 END) AS ret_5d,
               (CASE WHEN p.mv_latest IS NOT NULL AND p.mv_20  IS NOT NULL AND p.mv_20 > 0 THEN p.mv_latest / p.mv_20  - 1 END) AS ret_20d,
               (CASE WHEN p.mv_latest IS NOT NULL AND p.mv_60  IS NOT NULL AND p.mv_60 > 0 THEN p.mv_latest / p.mv_60  - 1 END) AS ret_60d,
               (CASE WHEN p.mv_latest IS NOT NULL AND p.mv_120 IS NOT NULL AND p.mv_120> 0 THEN p.mv_latest / p.mv_120 - 1 END) AS ret_120d,
               (CASE WHEN p.mv_latest IS NOT NULL AND p.mv_252 IS NOT NULL AND p.mv_252> 0 THEN p.mv_latest / p.mv_252 - 1 END) AS ret_252d
        FROM points p LEFT JOIN vol v USING (pcode)
      )
      SELECT (SELECT max_dt FROM latest_dt) AS latest_dt, j.*
      FROM joined j
      ORDER BY (j.pcode = LOWER('${esc(sectorCode)}')) DESC, j.mv_latest DESC NULLS LAST
    `

    const rows = await new Promise((resolve, reject) => con.all(sql, (e, r) => (e ? reject(e) : resolve(r))))
    const latestDtRaw = rows?.[0]?.latest_dt ?? null
    const displayDt = typeof latestDtRaw === 'string'
      ? latestDtRaw
      : latestDtRaw?.toISOString ? latestDtRaw.toISOString().slice(0, 10) : latestDtRaw

    const sectorRow = rows.find(r => r.pcode === sectorCode.toLowerCase()) || null
    const sector = sectorRow ? {
      market_cap: sectorRow.mv_latest ?? null,
      ret5: sectorRow.ret_5d ?? null,
      ret20: sectorRow.ret_20d ?? null,
      ret60: sectorRow.ret_60d ?? null,
      ret120: sectorRow.ret_120d ?? null,
      ret252: sectorRow.ret_252d ?? null,
      vol60: sectorRow.vol_60d ?? null,
    } : null

    const subsectors = rows
      .filter(r => r.pcode !== sectorCode.toLowerCase())
      .map(r => {
        const pcode = r.pcode
        const subsector_slug = pcode.endsWith(`_${sectorUnderscore}`)
          ? pcode.replace(/^subsector_/, '').replace(new RegExp(`${suffixPattern}`), '')
          : pcode.replace(/^subsector_/, '')
        return {
          subsector_slug,
          market_cap: r.mv_latest ?? null,
          ret5: r.ret_5d ?? null,
          ret20: r.ret_20d ?? null,
          ret60: r.ret_60d ?? null,
          ret120: r.ret_120d ?? null,
          ret252: r.ret_252d ?? null,
          vol60: r.vol_60d ?? null,
        }
      })

    return { dt: displayDt ?? null, sector, subsectors, error: null }
  } catch (err) {
    return { dt: null, sector: null, subsectors: [], error: String(err?.message ?? err) }
  } finally { con.close() }
}

/* -------------- Companies + best/worst (no placeholders) -------------- */
async function getSectorData(slug) {
  const duckdb = (await import('duckdb')).default
  const db = new duckdb.Database(DB_PATH)
  const con = db.connect()

  const slugSafe = String(slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const slugLit  = esc(slugSafe)

  const companiesSQL = `
    WITH normalized AS (
      SELECT gics_sector, LOWER(regexp_replace(gics_sector, '[^0-9A-Za-z]+', '-')) AS sector_slug
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
    WHERE t.gics_sector IN (SELECT gics_sector FROM normalized WHERE sector_slug = '${slugLit}')
    ORDER BY t.market_cap DESC NULLS LAST, t.ticker;
  `

  const bestSQL = `
    WITH normalized AS (
      SELECT gics_sector, LOWER(regexp_replace(gics_sector, '[^0-9A-Za-z]+', '-')) AS sector_slug
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
    WHERE t.gics_sector IN (SELECT gics_sector FROM normalized WHERE sector_slug = '${slugLit}')
    ORDER BY l60.ret60 DESC
    LIMIT 5;
  `

  const worstSQL = `
    WITH normalized AS (
      SELECT gics_sector, LOWER(regexp_replace(gics_sector, '[^0-9A-Za-z]+', '-')) AS sector_slug
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
    WHERE t.gics_sector IN (SELECT gics_sector FROM normalized WHERE sector_slug = '${slugLit}')
    ORDER BY l60.ret60 ASC
    LIMIT 5;
  `

  try {
    const companies = await new Promise((resolve, reject) => con.all(companiesSQL, (e, r) => (e ? reject(e) : resolve(r))))
    const best = await new Promise((resolve, reject) => con.all(bestSQL, (e, r) => (e ? reject(e) : resolve(r))))
    const worst = await new Promise((resolve, reject) => con.all(worstSQL, (e, r) => (e ? reject(e) : resolve(r))))
    return { companies, best, worst }
  } catch (err) {
    return { companies: [], best: [], worst: [], error: String(err?.message ?? err) }
  } finally { con.close() }
}

/* --------------------------------- Page --------------------------------- */
export default async function Page({ params }) {
  const { slug } = params || {}
  const [caps, { companies, best, worst }] = await Promise.all([
    getSubsectorCaps(slug),
    getSectorData(slug),
  ])

  const sectorName =
    companies?.[0]?.gics_sector ??
    (slug || '').replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase())

  return (
    <>
      {/* Global print styles (server-safe) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  .no-print { display: none !important; }
  a[href]:after { content: "" !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
          `,
        }}
      />

      {/* Top action bar */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-end gap-3 bg-white/80 backdrop-blur px-6 py-3 border-b">
        <PrintButton />
      </div>

      {/* Content */}
      <main id="sector-page-root" className="min-h-screen p-6 space-y-6">
        {(caps.error || ((companies?.length ?? 0) === 0 && (best?.length ?? 0) === 0 && (worst?.length ?? 0) === 0)) && (
          <div className="rounded-lg border border-red-300 bg-red-50 text-red-700 p-3">
            Data error {caps.error ? `— ${caps.error}` : ''}
          </div>
        )}

        {/* Performance & Momentum (subsector + sector total) */}
        <div className="rounded-xl border overflow-x-auto">
          <div className="px-4 py-3 border-b bg-gray-50 font-semibold">
            Performance &amp; Momentum — {caps.dt ?? '—'}
          </div>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-semibold">SubSector</th>
                <th className="text-right p-3 font-semibold">MarketCap</th>
                <th className="text-right p-3 font-semibold">5D Ret</th>
                <th className="text-right p-3 font-semibold">1M Ret</th>
                <th className="text-right p-3 font-semibold">3M Ret</th>
                <th className="text-right p-3 font-semibold">6M Ret</th>
                <th className="text-right p-3 font-semibold">1Y Ret</th>
                <th className="text-right p-3 font-semibold">Vol (60D)</th>
              </tr>
            </thead>
            <tbody>
              {caps.sector && (
                <tr className="border-t bg-gray-50/50">
                  <td className="p-3 font-medium">{sectorName} — Total</td>
                  <td className="p-3 text-right tabular-nums">{fmtCap(caps.sector.market_cap)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(caps.sector.ret5)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(caps.sector.ret20)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(caps.sector.ret60)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(caps.sector.ret120)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(caps.sector.ret252)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(caps.sector.vol60)}</td>
                </tr>
              )}

              {(caps.subsectors ?? []).map((r, i) => (
                <tr key={r.subsector_slug + i} className="border-t">
                  <td className="p-3 font-medium">{titleFromSlug(r.subsector_slug)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtCap(r.market_cap)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.ret5)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.ret20)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.ret60)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.ret120)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.ret252)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.vol60)}</td>
                </tr>
              ))}

              {(caps.subsectors ?? []).length === 0 && !caps.sector && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-gray-500">
                    No subsector portfolios found for this sector (latest {caps.dt ?? '—'}).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mb-2 flex items-center gap-3">
          <Link href="/sector" className="text-blue-600 hover:underline">← All Sectors</Link>
          <h1 className="text-2xl font-bold">{sectorName}</h1>
        </div>

        {/* Top/Bottom performers */}
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
                {(best ?? []).map((r, i) => (
                  <tr key={r.ticker + i} className="border-t">
                    <td className="p-3 font-medium">{r.ticker}</td>
                    <td className="p-3">{r.name ?? '—'}</td>
                    <td className="p-3 text-right tabular-nums">{fmtPct(r.ret60)}</td>
                  </tr>
                ))}
                {(best ?? []).length === 0 && <tr><td colSpan={3} className="p-6 text-center text-gray-500">No data.</td></tr>}
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
                {(worst ?? []).map((r, i) => (
                  <tr key={r.ticker + i} className="border-t">
                    <td className="p-3 font-medium">{r.ticker}</td>
                    <td className="p-3">{r.name ?? '—'}</td>
                    <td className="p-3 text-right tabular-nums">{fmtPct(r.ret60)}</td>
                  </tr>
                ))}
                {(worst ?? []).length === 0 && <tr><td colSpan={3} className="p-6 text-center text-gray-500">No data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Companies table */}
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
              {(companies ?? []).map((r, i) => (
                <tr key={r.ticker + i} className="border-t">
                  <td className="p-3 font-medium">{r.name ?? '—'}</td>
                  <td className="p-3">{r.ticker}</td>
                  <td className="p-3">{r.gics_subsector ?? '—'}</td>
                  <td className="p-3">{r.industry ?? '—'}</td>
                  <td className="p-3 text-right tabular-nums">{fmtCap(r.market_cap)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtPct(r.ret300)}</td>
                </tr>
              ))}
              {(companies ?? []).length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-gray-500">No companies found for this sector.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  )
}
