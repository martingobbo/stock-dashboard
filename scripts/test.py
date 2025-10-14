#!/usr/bin/env python3
"""
Resume-safe, budget-agnostic FMP job planner (NO DOWNLOADS).

What it does:
- Reads tickers from DuckDB (dim_ticker)
- Scans local .jsonl files under data/raw/fmp
- Detects which of the 7 endpoints are already present (period-aware for FY/Q)
- Prioritizes partially-complete tickers (fewest missing first), then untouched
- Prints:
    1) A compact status table (what you ALREADY HAVE)
    2) The NEXT 30 JOBS it WOULD do (without making any API calls)

Usage:
  python3 fmp_plan_jobs.py --limit 40

Notes:
- Mirrors your current logic/paths and endpoint labels:
  STATUS_COLS = ["inc_FY","inc_Q","bs_FY","bs_Q","cf_FY","cf_Q","ratios"]
- “Presence” for statements is determined by rows whose `period` indicates FY or quarter.
- Ratios = present if file has any rows.
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple
import duckdb

# ================== CONFIG ==================
DB_PATH = "/Users/martingobbo/stock-dashboard/data/serving/analytics.duckdb"

# Match your current project layout (NO 'app' in this one)
RAW_ROOT = Path("/Users/martingobbo/stock-dashboard/data/raw/fmp")

SUBDIRS = {
    "income_statement": RAW_ROOT / "income_statement",
    "balance_sheet":    RAW_ROOT / "balance_sheet",
    "cash_flow":        RAW_ROOT / "cash_flow",
    "ratios":           RAW_ROOT / "ratios",
}

# Keep labels aligned with your downloader’s logic
STATUS_COLS = ["inc_FY", "inc_Q", "bs_FY", "bs_Q", "cf_FY", "cf_Q", "ratios"]

# Parallel structure (index-aligned with STATUS_COLS) for planning only
# (subdir, human_label, want_period)
# want_period: "annual"/"quarter"/None (None for ratios)
ENDPOINT_PLAN: List[Tuple[str, str, str]] = [
    ("income_statement", "inc_FY", "annual"),
    ("income_statement", "inc_Q",  "quarter"),
    ("balance_sheet",    "bs_FY",  "annual"),
    ("balance_sheet",    "bs_Q",   "quarter"),
    ("cash_flow",        "cf_FY",  "annual"),
    ("cash_flow",        "cf_Q",   "quarter"),
    ("ratios",           "ratios", None),
]


# ================== HELPERS ==================
def ensure_dirs():
    for p in SUBDIRS.values():
        p.mkdir(parents=True, exist_ok=True)


def get_all_tickers_from_duckdb() -> List[str]:
    con = duckdb.connect(DB_PATH, read_only=True)
    rows = con.execute("SELECT ticker FROM dim_ticker ORDER BY ticker;").fetchall()
    return [r[0] for r in rows]


def file_has_any_rows(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        with path.open("r") as f:
            for _ in f:
                return True
    except Exception:
        return False
    return False


def jsonl_has_period(path: Path, want_period: str) -> bool:
    if not path.exists():
        return False
    annual_tags = {"fy", "annual", "year"}
    try:
        with path.open("r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                p = str(obj.get("period", "")).strip().lower()
                if want_period == "annual":
                    if p in annual_tags:
                        return True
                else:  # "quarter"
                    if p == "quarter" or p.startswith("q"):  # catches q1–q4
                        return True
    except Exception:
        return False
    return False


def detect_status_for_symbol(sym: str) -> Dict[str, bool]:
    """
    Builds the 7-column presence map for a ticker.
    For statements, checks period-aware presence inside the shared .jsonl.
    For ratios, presence == any row in file.
    """
    status = {k: False for k in STATUS_COLS}

    inc_path = SUBDIRS["income_statement"] / f"{sym}.jsonl"
    status["inc_FY"] = jsonl_has_period(inc_path, "annual")
    status["inc_Q"]  = jsonl_has_period(inc_path, "quarter")

    bs_path = SUBDIRS["balance_sheet"] / f"{sym}.jsonl"
    status["bs_FY"] = jsonl_has_period(bs_path, "annual")
    status["bs_Q"]  = jsonl_has_period(bs_path, "quarter")

    cf_path = SUBDIRS["cash_flow"] / f"{sym}.jsonl"
    status["cf_FY"] = jsonl_has_period(cf_path, "annual")
    status["cf_Q"]  = jsonl_has_period(cf_path, "quarter")

    ratios_path = SUBDIRS["ratios"] / f"{sym}.jsonl"
    status["ratios"] = file_has_any_rows(ratios_path)

    return status


def print_status_table(status_map: Dict[str, Dict[str, bool]], limit: int = 40):
    """
    Prints a compact table of what you ALREADY HAVE (first N tickers for readability).
    """
    cols = ["ticker"] + STATUS_COLS + ["missing"]
    header = " | ".join(f"{c:>8s}" for c in cols)
    print("\n=== STATUS (first {} tickers) ===".format(limit))
    print(header)
    print("-" * len(header))
    count = 0
    for sym, st in status_map.items():
        missing = sum(1 for v in st.values() if not v)
        row = [sym] + [("✔" if st[c] else "·") for c in STATUS_COLS] + [str(missing)]
        print(" | ".join(f"{c:>8s}" for c in row))
        count += 1
        if count >= limit:
            break

    total_syms = len(status_map)
    total_missing = sum(sum(1 for v in st.values() if not v) for st in status_map.values())
    print(f"\n[summary] symbols: {total_syms} | total missing endpoints: {total_missing}\n")


def missing_count(st: Dict[str, bool]) -> int:
    return sum(1 for v in st.values() if not v)


def plan_jobs(status_map: Dict[str, Dict[str, bool]]) -> List[Tuple[str, str]]:
    """
    Create the prioritized flat list of jobs (ticker, endpoint_label) WITHOUT calling any APIs.
    Priority:
      1) Tickers with FEWEST missing endpoints first (partially-complete first)
      2) Alphabetical within same missing count
      3) If 'AON' exists and needs anything, move it to the very front
    Within a ticker, job order follows STATUS_COLS/ENDPOINT_PLAN.
    """
    tickers = list(status_map.keys())

    # Filter to tickers that still need something
    needers = [sym for sym in tickers if missing_count(status_map[sym]) > 0]

    # Sort by fewest missing first, then alpha
    needers.sort(key=lambda s: (missing_count(status_map[s]), s))

    # AON bump to front if needed
    if "AON" in needers:
        needers.remove("AON")
        needers.insert(0, "AON")

    jobs: List[Tuple[str, str]] = []
    for sym in needers:
        st = status_map[sym]
        # For each endpoint (aligned with STATUS_COLS), add if missing
        for subdir, label, want_period in ENDPOINT_PLAN:
            if not st[label]:
                jobs.append((sym, label))
    return jobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=40, help="Max tickers to show in the status table.")
    args = ap.parse_args()

    ensure_dirs()

    # 1) Universe
    tickers = get_all_tickers_from_duckdb()
    print(f"[info] total dim_ticker symbols: {len(tickers)}")

    # 2) Status map (what you already have, per endpoint)
    status_map: Dict[str, Dict[str, bool]] = {}
    for sym in tickers:
        status_map[sym] = detect_status_for_symbol(sym)

    # 3) Print presence snapshot
    print_status_table(status_map, limit=args.limit)

    # 4) Plan next jobs (no downloads)
    planned = plan_jobs(status_map)

    # 5) Print the NEXT 30 jobs it WOULD do
    print("=== NEXT 30 JOBS (no API calls, just planning) ===")
    show = planned[:30]
    if not show:
        print("(no pending jobs — everything appears present)")
    else:
        for i, (sym, label) in enumerate(show, 1):
            # Pretty endpoint target description
            if label.endswith("_FY"):
                scope = "annual"
            elif label.endswith("_Q"):
                scope = "quarter"
            elif label == "ratios":
                scope = "all"
            else:
                scope = "n/a"

            print(f"{i:2d}. {sym:<8s} → {label:<7s} ({scope})")

    # 6) Final summary
    total_missing_after = sum(missing_count(st) for st in status_map.values())
    print(f"\n[plan] total planned jobs (all, flattened): {len(planned)}")
    print(f"[plan] total missing endpoints across universe: {total_missing_after}\n")


if __name__ == "__main__":
    main()
