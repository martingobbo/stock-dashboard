import json
from collections import Counter
from pathlib import Path

RAW = Path("/Users/martingobbo/stock-dashboard/app/data/raw/fmp")
FILES = {
    "income_statement": RAW / "income_statement" / "AAPL.jsonl",
    "balance_sheet":    RAW / "balance_sheet" / "AAPL.jsonl",
    "cash_flow":        RAW / "cash_flow" / "AAPL.jsonl",
    "ratios":           RAW / "ratios" / "AAPL.jsonl",
}

def peek_jsonl(path: Path, max_rows=5):
    keys_counter = Counter()
    samples = []
    total = 0
    with open(path, "r") as f:
        for line in f:
            total += 1
            obj = json.loads(line)
            keys_counter.update(obj.keys())
            if len(samples) < max_rows:
                # keep a light sample (only show a few keys/values)
                samples.append({k: obj.get(k) for k in list(obj.keys())[:10]})
    return total, keys_counter, samples

def main():
    for name, p in FILES.items():
        print(f"\n=== {name} ===")
        if not p.exists():
            print(f"  ⚠️ Missing file: {p}")
            continue
        total, keys, samples = peek_jsonl(p, max_rows=3)
        print(f"  Path: {p}")
        print(f"  Rows: {total}")
        print(f"  Distinct fields: {len(keys)}")
        # show the top 20 most-common fields
        print("  Top fields:", ", ".join([f"{k}({c})" for k, c in keys.most_common(20)]))
        # show a few example rows (first 10 keys only)
        for i, s in enumerate(samples, 1):
            print(f"  Sample row {i}: {s} ...")

if __name__ == "__main__":
    main()
