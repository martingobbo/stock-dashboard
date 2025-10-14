# scripts/download_aapl_fmp.py
# Downloads max-history fundamentals for AAPL and stores JSONL into your app/data/raw/fmp folders.

import json
import time
from pathlib import Path
import requests

# --- CONFIG (edit only the API key if needed) ---
API_KEY = "c5PobUQjaaMTHySILWqmWi9uyIDqYJBi"  # <-- paste your key
SYMBOL = "AAPL"

# Absolute project paths (as you specified)
RAW_ROOT = Path("/Users/martingobbo/stock-dashboard/app/data/raw/fmp")

SLEEP_BETWEEN_CALLS = 1.0  # seconds; polite throttle
BASE = "https://financialmodelingprep.com/api/v3"

# 7 calls: income (annual, quarterly), balance (annual, quarterly), cash (annual, quarterly), ratios (annual)
ENDPOINTS = [
    ("income_statement",  f"{BASE}/income-statement/{{sym}}",        {"period":"annual","limit":60}),
    ("income_statement",  f"{BASE}/income-statement/{{sym}}",        {"period":"quarter","limit":40}),
    ("balance_sheet",     f"{BASE}/balance-sheet-statement/{{sym}}", {"period":"annual","limit":60}),
    ("balance_sheet",     f"{BASE}/balance-sheet-statement/{{sym}}", {"period":"quarter","limit":40}),
    ("cash_flow",         f"{BASE}/cash-flow-statement/{{sym}}",     {"period":"annual","limit":60}),
    ("cash_flow",         f"{BASE}/cash-flow-statement/{{sym}}",     {"period":"quarter","limit":40}),
    ("ratios",            f"{BASE}/ratios/{{sym}}",                  {"limit":60}),
]
# -------------------------------------------------

def ensure_dirs():
    for sub in ["income_statement","balance_sheet","cash_flow","ratios"]:
        (RAW_ROOT / sub).mkdir(parents=True, exist_ok=True)

def append_jsonl(path: Path, rows):
    if not rows:
        return
    with open(path, "a") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")

def get_json(url, params, session: requests.Session):
    """One HTTP GET with basic retry/backoff; returns list (possibly empty)."""
    q = dict(params or {})
    q["apikey"] = API_KEY
    backoff = [0, 5, 15, 45]  # s
    for i, wait in enumerate(backoff):
        if wait:
            time.sleep(wait)
        try:
            r = session.get(url, params=q, timeout=30)
            if r.status_code == 200:
                data = r.json()
                time.sleep(SLEEP_BETWEEN_CALLS)
                return data if isinstance(data, list) else []
            if r.status_code in (429, 500, 502, 503, 504):
                # retry with next backoff step
                if i == len(backoff) - 1:
                    print(f"[warn] {r.status_code} {url} (giving up)")
                    return []
                print(f"[retry] {r.status_code} {url} → backoff {backoff[i+1]}s")
                continue
            # other non-200: log and return empty
            print(f"[warn] HTTP {r.status_code} {url}")
            return []
        except Exception as e:
            if i == len(backoff) - 1:
                print(f"[warn] exception {e} for {url} (giving up)")
                return []
            print(f"[retry] exception {e} → backoff {backoff[i+1]}s")
            continue
    return []

def download_one_ticker(symbol: str):
    ensure_dirs()
    with requests.Session() as s:
        for subdir, tmpl, params in ENDPOINTS:
            url = tmpl.format(sym=symbol)
            data = get_json(url, params, s)
            out_path = RAW_ROOT / subdir / f"{symbol}.jsonl"
            append_jsonl(out_path, data)
            print(f"[ok] {symbol} {subdir}: +{len(data)} rows → {out_path}")

def main():
    print(f"[start] Downloading fundamentals for {SYMBOL}")
    download_one_ticker(SYMBOL)
    print("[done] All AAPL endpoints fetched.")

if __name__ == "__main__":
    main()
