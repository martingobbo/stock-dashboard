#!/usr/bin/env python3
"""
Resume-safe, budget-aware FMP downloader.

- Reads tickers from DuckDB: dim_ticker
- Checks which endpoints are missing per ticker (by scanning existing .jsonl for period)
- Builds a status "dataframe-like" table (printed) with columns:
    inc_FY, inc_Q, bs_FY, bs_Q, cf_FY, cf_Q, ratios
- Prioritizes partially-complete tickers first, then untouched tickers
- Downloads ONLY the missing endpoints until the daily API call budget is exhausted

Usage:
  python3 fmp_resume_budgeted.py --budget 239 --sleep 1.0
"""

import argparse
import json
import time
from pathlib import Path
import requests
import duckdb
from typing import Dict, List, Tuple

# ================== CONFIG ==================
API_KEY = "c5PobUQjaaMTHySILWqmWi9uyIDqYJBi"  # <- your key
DB_PATH = "/Users/martingobbo/stock-dashboard/data/serving/analytics.duckdb"

# Use the "app" path (matches your current project layout)
RAW_ROOT = Path("/Users/martingobbo/stock-dashboard/data/raw/fmp")

# Directory names and endpoint shapes
SUBDIRS = {
    "income_statement": RAW_ROOT / "income_statement",
    "balance_sheet":    RAW_ROOT / "balance_sheet",
    "cash_flow":        RAW_ROOT / "cash_flow",
    "ratios":           RAW_ROOT / "ratios",
}

BASE = "https://financialmodelingprep.com/api/v3"
ENDPOINTS: List[Tuple[str, str, Dict[str, str]]] = [
    ("income_statement",  f"{BASE}/income-statement/{{sym}}",        {"period": "annual",  "limit": "60"}),  # inc_FY
    ("income_statement",  f"{BASE}/income-statement/{{sym}}",        {"period": "quarter", "limit": "40"}),  # inc_Q
    ("balance_sheet",     f"{BASE}/balance-sheet-statement/{{sym}}", {"period": "annual",  "limit": "60"}),  # bs_FY
    ("balance_sheet",     f"{BASE}/balance-sheet-statement/{{sym}}", {"period": "quarter", "limit": "40"}),  # bs_Q
    ("cash_flow",         f"{BASE}/cash-flow-statement/{{sym}}",     {"period": "annual",  "limit": "60"}),  # cf_FY
    ("cash_flow",         f"{BASE}/cash-flow-statement/{{sym}}",     {"period": "quarter", "limit": "40"}),  # cf_Q
    ("ratios",            f"{BASE}/ratios/{{sym}}",                  {"limit": "60"}),                       # ratios
]

# Labels we’ll use in the status table (parallel to ENDPOINTS)
STATUS_COLS = ["inc_FY", "inc_Q", "bs_FY", "bs_Q", "cf_FY", "cf_Q", "ratios"]


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
    """
    Detect if a .jsonl file for a statement contains rows with the requested period.
    want_period is 'annual' or 'quarter'. FMP rows typically have 'period' field like 'FY' or 'quarter'.
    We will treat ('annual' -> 'FY') and ('quarter' -> 'quarter').
    """
    if not path.exists():
        return False

    target = "FY" if want_period == "annual" else "quarter"
    try:
        with path.open("r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    # guard: some rows might miss 'period'
                    p = str(obj.get("period", "")).lower()
                    if target == "fy":
                        if p in ("fy", "annual", "year"):
                            return True
                    else:
                        if p == "quarter":
                            return True
                except Exception:
                    continue
    except Exception:
        return False

    return False


def detect_status_for_symbol(sym: str) -> Dict[str, bool]:
    """
    Returns a dict for the 7 columns in STATUS_COLS saying which data the symbol already has.
    A .jsonl file is shared per subdir (e.g., income_statement/<sym>.jsonl holds FY+Q),
    so we need period-aware checks for those with 'period'.
    """
    status = {k: False for k in STATUS_COLS}

    # income_statement (annual + quarter in same file)
    inc_path = SUBDIRS["income_statement"] / f"{sym}.jsonl"
    status["inc_FY"] = jsonl_has_period(inc_path, "annual")
    status["inc_Q"]  = jsonl_has_period(inc_path, "quarter")

    # balance_sheet
    bs_path = SUBDIRS["balance_sheet"] / f"{sym}.jsonl"
    status["bs_FY"] = jsonl_has_period(bs_path, "annual")
    status["bs_Q"]  = jsonl_has_period(bs_path, "quarter")

    # cash_flow
    cf_path = SUBDIRS["cash_flow"] / f"{sym}.jsonl"
    status["cf_FY"] = jsonl_has_period(cf_path, "annual")
    status["cf_Q"]  = jsonl_has_period(cf_path, "quarter")

    # ratios (no periods – presence = any row)
    ratios_path = SUBDIRS["ratios"] / f"{sym}.jsonl"
    status["ratios"] = file_has_any_rows(ratios_path)

    return status


def print_status_table(status_map: Dict[str, Dict[str, bool]], limit: int = 40):
    """
    Pretty-print a compact table for a quick look.
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


def append_jsonl(path: Path, rows: List[dict]):
    if not rows:
        return
    with path.open("a") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")


def get_json(url: str, params: Dict[str, str], session: requests.Session) -> Tuple[int, List[dict]]:
    """
    Returns (status, data_list). status: 200 OK, -1 counted error (budget should decrement), or other http code
    We do not mutate budget here; caller will decrement on any counted attempt.
    """
    q = dict(params or {})
    q["apikey"] = API_KEY
    try:
        r = session.get(url, params=q, timeout=30)
    except Exception:
        return (-1, [])

    code = r.status_code
    if code == 200:
        try:
            data = r.json()
            if not isinstance(data, list):
                data = []
        except Exception:
            data = []
        return (200, data)

    return (code, [])


def download_missing_for_symbol(sym: str, status: Dict[str, bool], session: requests.Session,
                                sleep_between: float, calls_left: int) -> int:
    """
    For a symbol, call only the endpoints that are currently missing.
    Returns remaining calls after attempting this symbol (never negative).
    """
    # Build the missing queue for this symbol in the same order as STATUS_COLS/ENDPOINTS
    missing_jobs = []
    for (i, col) in enumerate(STATUS_COLS):
        if not status[col]:
            missing_jobs.append((i, col))

    if not missing_jobs:
        return calls_left

    # Run jobs while budget remains
    for idx, col in missing_jobs:
        if calls_left <= 0:
            break

        subdir, tmpl, params = ENDPOINTS[idx]
        url = tmpl.format(sym=sym)
        status_code, data = get_json(url, params, session)

        # Any attempt counts against budget (including errors/429)
        calls_left -= 1

        if status_code == 200:
            out_path = SUBDIRS[subdir] / f"{sym}.jsonl"
            append_jsonl(out_path, data)
            got = len(data)
            print(f"[ok] {sym:6s} {col:8s} → +{got:3d} rows → {out_path}")
            # Mark as present (even if 0 rows; the attempt was good — but you can choose to only mark if got>0)
            # Safer: re-detect immediately from disk for period-aware cols
            if subdir == "ratios":
                status["ratios"] = file_has_any_rows(out_path)
            elif subdir in ("income_statement", "balance_sheet", "cash_flow"):
                want_period = "annual" if col.endswith("FY") else "quarter"
                if jsonl_has_period(out_path, want_period):
                    status[col] = True
        else:
            # Graceful logging; let the prioritization move on
            print(f"[warn] {sym} {col} HTTP {status_code} (attempt counted)")

        if calls_left <= 0:
            break

        if sleep_between > 0:
            time.sleep(sleep_between)

    return max(calls_left, 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=int, default=240, help="Remaining daily API call budget (today).")
    ap.add_argument("--sleep", type=float, default=1.0, help="Seconds to sleep between successful calls.")
    args = ap.parse_args()

    ensure_dirs()

    # 1) Get tickers
    tickers = get_all_tickers_from_duckdb()
    print(f"[info] total dim_ticker symbols: {len(tickers)} | starting budget: {args.budget}")

    # 2) Build status map
    status_map: Dict[str, Dict[str, bool]] = {}
    for sym in tickers:
        status_map[sym] = detect_status_for_symbol(sym)

    # 3) Print a quick “dataframe-like” status snapshot
    print_status_table(status_map, limit=40)

    # 4) Prioritize: partially-complete first, then untouched (7 missing)
    def missing_count(sym: str) -> int:
        return sum(1 for v in status_map[sym].values() if not v)

    # Filter only those with at least one missing endpoint
    needers = [sym for sym in tickers if missing_count(sym) > 0]

    # Stable prioritization: fewest missing first; then alphabetical
    needers.sort(key=lambda s: (missing_count(s), s))

    # (Optional) Ensure AON is very first if it still needs anything
    if "AON" in needers:
        needers.remove("AON")
        needers.insert(0, "AON")

    # 5) Execute with budget guard
    calls_left = args.budget
    done_syms = 0
    with requests.Session() as s:
        for sym in needers:
            if calls_left <= 0:
                print("[stop] budget exhausted before next symbol")
                break
            calls_left = download_missing_for_symbol(sym, status_map[sym], s, args.sleep, calls_left)
            done_syms += 1

    # 6) Final summary
    total_missing_after = sum(sum(1 for v in st.values() if not v) for st in status_map.values())
    print(f"\n[done] processed symbols: {done_syms} | calls remaining: {calls_left}")
    print(f"[after] total missing endpoints across universe: {total_missing_after}\n")


if __name__ == "__main__":
    main()
