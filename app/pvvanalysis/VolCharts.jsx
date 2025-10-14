"use client"

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts"

/**
 * Props:
 * - series: array of { date, ... }
 * - leftKeys: keys to plot on the left chart
 * - rightKeys: keys to plot on the right chart (optional)
 * - format: "percent" | "number" (controls Y-axis + tooltip on BOTH charts)
 * - single: boolean (if true, render only the left chart)
 */
export default function VolCharts({
  series = [],
  leftKeys = [],
  rightKeys = [],
  format = "percent",
  single = false,
}) {
  const asPercent = format === "percent"

  const pct = (v) => (v == null ? "" : `${(v * 100).toFixed(2)}%`)
  const numFmt = (v) => (v == null ? "" : `${Number(v).toLocaleString()}`)

  const yTick = (v) => (asPercent ? pct(v) : numFmt(v))
  const tipFmt = (v) => (asPercent ? pct(v) : numFmt(v))

  // Distinct colors per key
  // Updated volatility line colors per request:
  // vol15  -> #494e84
  // vol60  -> #00a693
  // vol252 -> #74afda
  const colorMap = {
    // Volatility (updated)
    vol15:  "#494e84",
    vol60:  "#00a693",
    vol252: "#74afda",
    up60:   "#16a34a", // keep distinct green
    down60: "#ef4444", // keep distinct red

    // Dollar-Volume SMAs (unchanged)
    dvSMA60:  "#1f2937",
    dvSMA252: "#f59e0b",
  }

  const LeftChart = (
    <div className="h-72 w-full rounded-xl border bg-white p-3">
      <div className="mb-2 text-sm font-medium text-gray-700">
        {asPercent ? "Short / Medium / Long Vol" : "Dollar-Volume SMAs"}
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={yTick} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
          <Tooltip formatter={(v) => tipFmt(v)} labelStyle={{ fontSize: 12 }} />
          <Legend />
          {leftKeys.map((k) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              stroke={colorMap[k] ?? "#111827"} // fallback gray-900
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  const RightChart = (
    <div className="h-72 w-full rounded-xl border bg-white p-3">
      <div className="mb-2 text-sm font-medium text-gray-700">Long / Skew (Upside / Downside)</div>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={yTick} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
          <Tooltip formatter={(v) => tipFmt(v)} labelStyle={{ fontSize: 12 }} />
          <Legend />
          {rightKeys.map((k) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
              stroke={colorMap[k] ?? "#111827"}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  const showRight = !single && rightKeys && rightKeys.length > 0

  return (
    <div className={`grid gap-6 ${showRight ? "md:grid-cols-2" : "grid-cols-1"}`}>
      {LeftChart}
      {showRight ? RightChart : null}
    </div>
  )
}
