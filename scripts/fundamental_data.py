import os
from pathlib import Path

PROJECT_DIRNAME = "stock-dashboard"  # adjust if your folder is named differently

def find_project_root(start: Path) -> Path:
    p = start.resolve()
    while True:
        if p.name == PROJECT_DIRNAME:
            return p
        if p.parent == p:
            # Fallback: assume the parent of start is the project root
            return start.resolve().parents[0]
        p = p.parent

def check_path(path: Path):
    exists = path.exists()
    readable = os.access(path, os.R_OK) if exists else False
    writable = os.access(path, os.W_OK) if exists else False
    return exists, readable, writable

def main():
    script_path = Path(__file__).resolve()
    print(f"Script: {script_path}")

    project_root = find_project_root(script_path)
    print(f"Project root: {project_root}")

    # Your current layout lives under app/data/raw/fmp
    fmp_root = project_root / "app" / "data" / "raw" / "fmp"
    print(f"FMP root (expected): {fmp_root}")

    subdirs = ["income_statement", "balance_sheet", "cash_flow", "ratios"]

    print("\nSubdirectory checks (no creation, read-only):")
    for s in subdirs:
        p = fmp_root / s
        exists, readable, writable = check_path(p)
        print(f"  {s}: {p}")
        print(f"     exists:   {exists}")
        print(f"     readable: {readable}")
        print(f"     writable: {writable}")

        # Show where we'd save (without touching disk)
        example_symbol = "AAPL"
        example_jsonl = p / f"{example_symbol}.jsonl"
        print(f"     example save path (no write): {example_jsonl}")

    # Also show where your UI snapshot would go (tiny JSON for Next.js)
    ui_snapshot = project_root / "public" / "data" / "fundamentals_latest.json"
    print(f"\nUI snapshot (read by Next.js): {ui_snapshot}")
    print("No files or folders were created by this script.")

if __name__ == "__main__":
    main()
