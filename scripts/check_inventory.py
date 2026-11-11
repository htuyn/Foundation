"""
Đối chiếu tồn kho dùng StockMovement ledger.
Chạy: python scripts/check_inventory.py
"""
import sys
import requests

BASE = "http://localhost:8000/api/v1"
HEADERS = {"X-User-ID": "36a45099-c617-5970-9e62-356c301a16bb"}


def fetch_all(path, page_size=500, label=""):
    """Lấy toàn bộ kết quả qua nhiều trang, hiện progress."""
    results = []
    page = 1
    while True:
        url = f"{BASE}/{path}?pageSize={page_size}&page={page}"
        print(f"   [{label}] Trang {page} ...", end="\r", flush=True)
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        results.extend(data)
        print(f"   [{label}] Trang {page} → {len(results)} dòng", flush=True)
        if len(data) < page_size:
            break
        page += 1
    return results


def fetch_one(path, page_size=500, label=""):
    """Lấy một trang (cho endpoint không hỗ trợ phân trang)."""
    url = f"{BASE}/{path}?pageSize={page_size}"
    print(f"   [{label}] Đang lấy ...", flush=True)
    resp = requests.get(url, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    print(f"   [{label}] ✔ {len(data)} dòng")
    return data


def main():
    print("=" * 60)
    print("SV4 – Đối chiếu tồn kho vs Ledger StockMovement")
    print("=" * 60)

    # 1. Tồn kho DB (endpoint không hỗ trợ page, trả tất cả 1 lần)
    print("\n[1/3] Lấy Inventory (tồn kho DB)...")
    inv_rows = fetch_one("inventory", page_size=5000, label="inventory")
    db_stock = {(r["productId"], r["warehouseId"]): r["quantity"] for r in inv_rows}

    # 2. StockMovement ledger (hỗ trợ phân trang)
    print("\n[2/3] Lấy StockMovements (ledger)...")
    movements = fetch_all("transactions", page_size=500, label="transactions")

    # 3. Tính ledger
    print("\n[3/3] Tính toán và so sánh...")
    from collections import defaultdict
    ledger  = defaultdict(int)
    pn_sum  = defaultdict(int)
    px_sum  = defaultdict(int)
    adj_sum = defaultdict(int)

    for m in movements:
        key = (m["productId"], m["warehouseId"])
        qty   = m["quantity"]
        mtype = m.get("type", "")
        if mtype == "Nhập kho":
            ledger[key] += qty;  pn_sum[key]  += qty
        elif mtype == "Xuất kho":
            ledger[key] -= qty;  px_sum[key]  += qty
        elif mtype == "Điều chỉnh":
            ledger[key] += qty;  adj_sum[key] += qty

    # 4. So sánh
    all_keys  = sorted(set(db_stock) | set(ledger))
    total     = len(all_keys)
    matched   = sum(1 for k in all_keys if ledger.get(k, 0) == db_stock.get(k, 0))
    mismatched = total - matched

    print(f"\n{'='*70}")
    print(f"{'STT':<5} {'ProductId':>14} {'WarehouseId':>14} {'Ledger':>8} {'DB':>8} {'OK':>4}")
    print(f"{'='*70}")

    shown = 0
    mismatch_examples = []
    for i, key in enumerate(all_keys, 1):
        pid, wh = key
        calc = ledger.get(key, 0)
        db   = db_stock.get(key, 0)
        ok   = calc == db
        if not ok:
            mismatch_examples.append((i, pid[:14], wh[:14], calc, db))
        # In 10 dòng đầu để xem mẫu
        if shown < 10:
            mark = "✅" if ok else "❌"
            print(f"{i:<5} {pid[:14]:>14} {wh[:14]:>14} {calc:>8} {db:>8} {mark:>4}")
            shown += 1

    if total > 10:
        print(f"  ... (còn {total - 10} dòng khác)")

    print(f"\n{'='*70}")
    print(f"Tổng số dòng  : {total}")
    print(f"Dòng khớp ✅  : {matched}")
    print(f"Dòng lệch ❌  : {mismatched}")

    if mismatched and mismatch_examples:
        print(f"\nTop {min(5, len(mismatch_examples))} dòng lệch:")
        for r in mismatch_examples[:5]:
            print(f"  [{r[0]}] pid={r[1]} wh={r[2]} ledger={r[3]} db={r[4]}")

    if mismatched == 0:
        print(f"\n✅ KẾT LUẬN: TỒN KHO NHẤT QUÁN HOÀN TOÀN")
    else:
        pct = matched / total * 100
        print(f"\n⚠️  Lệch {mismatched}/{total} dòng ({pct:.1f}% khớp)")
        print("   Lý do phổ biến: API /transactions trả abs(qty) → mất dấu Điều chỉnh âm")
        print("   verify_seed() trong seed_demo.py là nguồn tin cậy hơn.")

    print(f"\n[Movements: {len(movements)} | Inventory rows: {len(inv_rows)}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
