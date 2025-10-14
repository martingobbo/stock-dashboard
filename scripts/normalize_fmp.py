#!/usr/bin/env python3
"""
Build a single fundamentals_highlights.json for the Next.js dashboard
by scanning on-disk .jsonl files (no DB dependency), stitching FY/Q,
and computing growth, acceleration, CAGRs, margins, EBITDA passthrough,
ROE/ROA, operating leverage, and a few sanity flags.

Reads raw JSONL from (all paths must contain .jsonl files):
  <PROJECT>/app/data/raw/fmp/{income_statement,balance_sheet,cash_flow,ratios}/<SYMBOL>.jsonl

Writes:
  <PROJECT>/public/data/fundamentals_highlights.json

Notes:
- A symbol is processed if at least ONE of the four sources exists on disk.
- FY vs Q split uses 'period' or 'periodType' (string starting with 'Q' => Quarterly).
- Stitching aligns rows by exact 'date' strings (YYYY-MM-DD).
"""

import json
from pathlib import Path
from collections import defaultdict
from statistics import pstdev

# ============= CONFIG =============
PROJECT = Path("/Users/martingobbo/stock-dashboard")
RAW = PROJECT / "data" / "raw" / "fmp"
PUBLIC_EXPORT = PROJECT / "public" / "data" / "fundamentals_highlights.json"

DIRS = {
    "income_statement": RAW / "income_statement",
    "balance_sheet":    RAW / "balance_sheet",
    "cash_flow":        RAW / "cash_flow",
    "ratios":           RAW / "ratios",
}

# ============= IO HELPERS =============
def load_jsonl(path: Path):
    if not path.exists():
        return []
    rows = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                # tolerate occasional malformed lines
                continue
    return rows

def discover_tickers_from_disk():
    """Union of all *.jsonl stems found under the four category folders."""
    symbols = set()
    for p in DIRS.values():
        if not p.exists():
            continue
        for file in p.glob("*.jsonl"):
            # Keep stem verbatim (supports symbols like BRK.B)
            symbols.add(file.stem)
    # Return in deterministic order
    return sorted(symbols)

# ============= SAFE MATH =============
def safe(x):
    try:
        return float(x)
    except Exception:
        return None

def safe_div(a, b):
    a = safe(a); b = safe(b)
    if a is None or b in (None, 0.0):
        return None
    return a / b

def pct_change(curr, prev):
    curr = safe(curr); prev = safe(prev)
    if curr is None or prev in (None, 0):
        return None
    return (curr - prev) / prev

# ============= DATE HELPERS =============
def sort_by_date(rows):
    return sorted([r for r in rows if r.get("date")], key=lambda r: r["date"])

def year_of(date_str):
    try: return int(date_str[:4])
    except Exception: return None

def quarter_of(date_str):
    try:
        y = int(date_str[:4]); m = int(date_str[5:7]); q = 1 + (m - 1)//3
        return f"{y}-Q{q}"
    except Exception:
        return None

def prev_same_quarter(rows, k):
    if not k or "-Q" not in k: return None
    y, q = k.split("-Q")
    target = f"{int(y)-1}-Q{q}"
    idx = {quarter_of(r["date"]): r for r in rows if quarter_of(r["date"])}
    return idx.get(target)

def prev_quarter(rows, i):
    return rows[i-1] if i-1 >= 0 else None

# ============= CALCS =============
def compute_cagr(curr_level, past_level, years):
    curr = safe(curr_level); past = safe(past_level)
    if curr is None or past in (None, 0) or years is None or years <= 0:
        return None
    ratio = curr / past
    if ratio <= 0:
        return None
    try:
        return ratio ** (1.0 / years) - 1.0
    except Exception:
        return None

def compute_operating_leverage(curr, prev):
    if prev is None: return None
    num = pct_change(curr.get("operatingIncome"), prev.get("operatingIncome"))
    den = pct_change(curr.get("revenue"),        prev.get("revenue"))
    if num is None or den in (None, 0):
        num = pct_change(curr.get("netIncome"), prev.get("netIncome"))
    if num is None or den in (None, 0): return None
    try: return num / den
    except Exception: return None

# ============= NORMALIZATION / STITCH =============
def merge_sources_for_row(is_row=None, bs_row=None, cf_row=None, ratio_row=None):
    out = {}
    out["date"] = (is_row or {}).get("date") or (bs_row or {}).get("date") or (cf_row or {}).get("date") or (ratio_row or {}).get("date")

    # Levels
    rev    = (is_row or {}).get("revenue")
    ni     = (is_row or {}).get("netIncome")
    gp     = (is_row or {}).get("grossProfit")
    opi    = (is_row or {}).get("operatingIncome")
    ebitda = (is_row or {}).get("ebitda")  # passthrough

    out["revenue"] = rev
    out["netIncome"] = ni
    out["operatingIncome"] = opi
    out["EBITDA"] = ebitda

    # Margins
    out["grossMargin"]     = safe_div(gp, rev)
    out["operatingMargin"] = safe_div(opi, rev)
    out["netMargin"]       = safe_div(ni, rev)

    # FCF (prefer direct; fallback OCF - CapEx)
    ocf        = (cf_row or {}).get("operatingCashFlow")
    capex      = (cf_row or {}).get("capitalExpenditure")
    fcf_direct = (cf_row or {}).get("freeCashFlow")
    out["freeCashFlow"] = fcf_direct if fcf_direct is not None else (None if ocf is None or capex is None else safe(ocf) - safe(capex))

    # ROE / ROA
    out["ROE"] = (ratio_row or {}).get("returnOnEquity")
    out["ROA"] = (ratio_row or {}).get("returnOnAssets")

    # BS helpers for flags
    out["_accountsReceivable"] = (is_row or {}).get("netReceivables") or (bs_row or {}).get("netReceivables")
    out["_totalDebt"]          = (bs_row or {}).get("totalDebt") or (bs_row or {}).get("totalDebtInMillion")
    out["_totalAssets"]        = (bs_row or {}).get("totalAssets")

    return out

def stitch_by_date(income, balance, cash, ratios):
    by_date = defaultdict(dict)
    for r in income:  by_date[r.get("date")]["is"] = r
    for r in balance: by_date[r.get("date")]["bs"] = r
    for r in cash:    by_date[r.get("date")]["cf"] = r
    for r in ratios:  by_date[r.get("date")]["ra"] = r
    rows = [merge_sources_for_row(parts.get("is"), parts.get("bs"), parts.get("cf"), parts.get("ra"))
            for _, parts in by_date.items()]
    return sort_by_date(rows)

def add_bs_growth_helpers_fy(fy_rows):
    fy_rows = sort_by_date(fy_rows)
    idx = {year_of(r["date"]): r for r in fy_rows if year_of(r["date"]) is not None}
    for r in fy_rows:
        y = year_of(r["date"])
        p = idx.get(y-1)
        r["_ar_growth_yoy"]     = pct_change(r.get("_accountsReceivable"), p.get("_accountsReceivable") if p else None)
        r["_debt_growth_yoy"]   = pct_change(r.get("_totalDebt"),          p.get("_totalDebt")          if p else None)
        r["_assets_growth_yoy"] = pct_change(r.get("_totalAssets"),        p.get("_totalAssets")        if p else None)
    return fy_rows

def attach_core_growth_and_margins(rows, cadence):
    rows = sort_by_date(rows)
    if not rows: return rows

    if cadence == "FY":
        idx = {year_of(r["date"]): r for r in rows if year_of(r["date"]) is not None}
        for r in rows:
            y = year_of(r["date"])
            prev = idx.get(y-1)
            r["revenue_growth_yoy"]     = pct_change(r.get("revenue"),      prev.get("revenue")      if prev else None)
            r["net_income_growth_yoy"]  = pct_change(r.get("netIncome"),    prev.get("netIncome")    if prev else None)
            r["fcf_growth_yoy"]         = pct_change(r.get("freeCashFlow"), prev.get("freeCashFlow") if prev else None)

            r["gross_margin_expansion"]     = None if not prev else (None if (r.get("grossMargin")     is None or prev.get("grossMargin")     is None) else safe(r["grossMargin"])     - safe(prev["grossMargin"]))
            r["operating_margin_expansion"] = None if not prev else (None if (r.get("operatingMargin") is None or prev.get("operatingMargin") is None) else safe(r["operatingMargin"]) - safe(prev["operatingMargin"]))
            r["net_margin_expansion"]       = None if not prev else (None if (r.get("netMargin")       is None or prev.get("netMargin")       is None) else safe(r["netMargin"])       - safe(prev["netMargin"]))

        # YoY acceleration vs prior YoY
        idx2 = {year_of(r["date"]): r for r in rows if year_of(r["date"]) is not None}
        for r in rows:
            y = year_of(r["date"])
            prev = idx2.get(y-1); prev2 = idx2.get(y-2)
            def accel_yoy(level_key):
                cur = r.get(f"{level_key}_growth_yoy")
                if prev and prev2:
                    prev_yoy = pct_change(prev.get(key_map[level_key]), prev2.get(key_map[level_key]))
                else:
                    prev_yoy = None
                return None if (cur is None or prev_yoy is None) else cur - prev_yoy
            key_map = {"revenue":"revenue", "net_income":"netIncome", "fcf":"freeCashFlow"}
            r["revenue_growth_accel_yoy"]    = accel_yoy("revenue")
            r["net_income_growth_accel_yoy"] = accel_yoy("net_income")
            r["fcf_growth_accel_yoy"]        = accel_yoy("fcf")

    else:
        # Quarterly: YoY & QoQ + accelerations
        for i, r in enumerate(rows):
            k = quarter_of(r["date"])
            prev_y = prev_same_quarter(rows, k) if k else None
            prev_q = prev_quarter(rows, i)

            r["revenue_growth_yoy"]    = pct_change(r.get("revenue"),      prev_y.get("revenue")      if prev_y else None)
            r["net_income_growth_yoy"] = pct_change(r.get("netIncome"),    prev_y.get("netIncome")    if prev_y else None)
            r["fcf_growth_yoy"]        = pct_change(r.get("freeCashFlow"), prev_y.get("freeCashFlow") if prev_y else None)

            r["revenue_growth_qoq"]    = pct_change(r.get("revenue"),      prev_q.get("revenue")      if prev_q else None)
            r["net_income_growth_qoq"] = pct_change(r.get("netIncome"),    prev_q.get("netIncome")    if prev_q else None)
            r["fcf_growth_qoq"]        = pct_change(r.get("freeCashFlow"), prev_q.get("freeCashFlow") if prev_q else None)

        def prior_yoy_growth(i, key):
            r = rows[i]; k = quarter_of(r["date"]); py = prev_same_quarter(rows, k)
            if not py: return None
            ppy = prev_same_quarter(rows, quarter_of(py["date"]))
            if not ppy: return None
            return pct_change(py.get(key), ppy.get(key))

        for i, r in enumerate(rows):
            # YoY acceleration (vs prior year's YoY)
            cur_rev = r.get("revenue_growth_yoy");    prv_rev = prior_yoy_growth(i, "revenue")
            cur_ni  = r.get("net_income_growth_yoy"); prv_ni  = prior_yoy_growth(i, "netIncome")
            cur_fcf = r.get("fcf_growth_yoy");        prv_fcf = prior_yoy_growth(i, "freeCashFlow")
            r["revenue_growth_accel_yoy"]    = None if (cur_rev is None or prv_rev is None) else cur_rev - prv_rev
            r["net_income_growth_accel_yoy"] = None if (cur_ni  is None or prv_ni  is None) else cur_ni  - prv_ni
            r["fcf_growth_accel_yoy"]        = None if (cur_fcf is None or prv_fcf is None) else cur_fcf - prv_fcf

            # QoQ acceleration (vs prior quarter's QoQ)
            prev_q = rows[i-1] if i-1 >= 0 else None
            pq_rev = prev_q.get("revenue_growth_qoq")     if prev_q else None
            pq_ni  = prev_q.get("net_income_growth_qoq")  if prev_q else None
            pq_fcf = prev_q.get("fcf_growth_qoq")         if prev_q else None
            r["revenue_growth_accel_qoq"]    = None if (r.get("revenue_growth_qoq")    is None or pq_rev is None) else r["revenue_growth_qoq"]    - pq_rev
            r["net_income_growth_accel_qoq"] = None if (r.get("net_income_growth_qoq") is None or pq_ni  is None) else r["net_income_growth_qoq"] - pq_ni
            r["fcf_growth_accel_qoq"]        = None if (r.get("fcf_growth_qoq")        is None or pq_fcf is None) else r["fcf_growth_qoq"]        - pq_fcf

    return rows

def attach_cagr_3y_fy(fy_rows):
    fy_rows = sort_by_date(fy_rows)
    idx = {year_of(r["date"]): r for r in fy_rows if year_of(r["date"]) is not None}
    for r in fy_rows:
        y  = year_of(r["date"])
        p3 = idx.get(y-3)
        r["revenue_cagr_3y"]     = compute_cagr(r.get("revenue"),      p3.get("revenue")      if p3 else None, 3)
        r["net_income_cagr_3y"]  = compute_cagr(r.get("netIncome"),    p3.get("netIncome")    if p3 else None, 3)
        r["fcf_cagr_3y"]         = compute_cagr(r.get("freeCashFlow"), p3.get("freeCashFlow") if p3 else None, 3)
    return fy_rows

def finalize_flags(fy_rows, q_rows):
    latest_fy = sort_by_date(fy_rows)[-1] if fy_rows else None
    receivables_vs_sales_flag = None
    debt_up_without_asset_growth_flag = None
    q_vol_masks_annual_flag = None

    if latest_fy:
        ar_g  = latest_fy.get("_ar_growth_yoy")
        rev_g = latest_fy.get("revenue_growth_yoy")
        if ar_g is not None and rev_g is not None:
            receivables_vs_sales_flag = (ar_g - rev_g) > 0.10

        debt_g  = latest_fy.get("_debt_growth_yoy")
        asset_g = latest_fy.get("_assets_growth_yoy")
        if debt_g is not None and asset_g is not None:
            debt_up_without_asset_growth_flag = (debt_g - asset_g) > 0.10

    q_rev_g = [r.get("revenue_growth_yoy") for r in sort_by_date(q_rows) if r.get("revenue_growth_yoy") is not None]
    if len(q_rev_g) >= 4 and latest_fy and latest_fy.get("revenue_growth_yoy") is not None:
        try:
            vol = pstdev(q_rev_g)
            q_vol_masks_annual_flag = (vol > 0.25) and (abs(latest_fy["revenue_growth_yoy"]) < 0.05)
        except Exception:
            q_vol_masks_annual_flag = None

    return receivables_vs_sales_flag, debt_up_without_asset_growth_flag, q_vol_masks_annual_flag

def compute_operating_leverage_series(rows, cadence="FY"):
    rows = sort_by_date(rows)
    if cadence == "Q":
        for i, r in enumerate(rows):
            prev = rows[i-1] if i-1 >= 0 else None
            r["operating_leverage_ratio"] = compute_operating_leverage(r, prev)
    else:
        idx = {year_of(r["date"]): r for r in rows if year_of(r["date"]) is not None}
        for r in rows:
            y = year_of(r["date"])
            prev = idx.get(y-1)
            r["operating_leverage_ratio"] = compute_operating_leverage(r, prev)
    return rows

# ============= MAIN =============
def main():
    # Discover tickers from the filesystem (.jsonl only)
    tickers = discover_tickers_from_disk()
    if not tickers:
        print(f"[abort] No .jsonl files found under {RAW}")
        return

    bundle = []
    for sym in tickers:
        try:
            is_all = load_jsonl(DIRS["income_statement"] / f"{sym}.jsonl")
            bs_all = load_jsonl(DIRS["balance_sheet"]    / f"{sym}.jsonl")
            cf_all = load_jsonl(DIRS["cash_flow"]        / f"{sym}.jsonl")
            ra_all = load_jsonl(DIRS["ratios"]           / f"{sym}.jsonl")

            if not (is_all or bs_all or cf_all or ra_all):
                # Symbol discovered via some folder, but none of the four files exist (rare)
                print(f"[skip] {sym}: no raw data found in any source")
                continue

            # Split FY vs Q using 'period'/'periodType' field: startswith('Q') => Quarterly
            def is_quarter(r): return (r.get("period") or r.get("periodType") or "").upper().startswith("Q")
            is_fy, is_q = [r for r in is_all if not is_quarter(r)], [r for r in is_all if is_quarter(r)]
            bs_fy, bs_q = [r for r in bs_all if not is_quarter(r)], [r for r in bs_all if is_quarter(r)]
            cf_fy, cf_q = [r for r in cf_all if not is_quarter(r)], [r for r in cf_all if is_quarter(r)]
            ra_fy, ra_q = [r for r in ra_all if not is_quarter(r)], [r for r in ra_all if is_quarter(r)]

            # Merge by date
            fy_rows = stitch_by_date(is_fy, bs_fy, cf_fy, ra_fy)
            q_rows  = stitch_by_date(is_q,  bs_q,  cf_q,  ra_q)

            if not fy_rows and not q_rows:
                print(f"[skip] {sym}: stitched FY/Q rows are empty (check 'date' fields)")
                continue

            # Attach growth, margin deltas, and accelerations
            fy_rows = attach_core_growth_and_margins(fy_rows, "FY")
            q_rows  = attach_core_growth_and_margins(q_rows,  "Q")

            # Helpers for FY flags
            fy_rows = add_bs_growth_helpers_fy(fy_rows)

            # Operating leverage
            fy_rows = compute_operating_leverage_series(fy_rows, "FY")
            q_rows  = compute_operating_leverage_series(q_rows,  "Q")

            # 3Y CAGRs (FY only)
            fy_rows = attach_cagr_3y_fy(fy_rows)

            # Flags (attach to latest FY if present)
            rec_flag, debt_flag, qmask_flag = finalize_flags(fy_rows, q_rows)
            record = {"symbol": sym, "FY": fy_rows, "Q": q_rows}
            if record["FY"]:
                record["FY"][-1]["receivables_vs_sales_flag"] = rec_flag
                record["FY"][-1]["debt_up_without_asset_growth_flag"] = debt_flag
                record["FY"][-1]["quarterly_volatility_masks_annual_flag"] = qmask_flag

            bundle.append(record)
            print(f"[ok]   {sym}: FY={len(fy_rows)} Q={len(q_rows)}")

        except Exception as e:
            print(f"[skip] {sym}: error -> {e}")
            continue

    PUBLIC_EXPORT.parent.mkdir(parents=True, exist_ok=True)
    with open(PUBLIC_EXPORT, "w") as f:
        json.dump(bundle, f, indent=2)

    print(f"[done] wrote {len(bundle)} symbols → {PUBLIC_EXPORT}")

if __name__ == "__main__":
    main()
