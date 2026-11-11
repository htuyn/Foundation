"""
Đối chiếu tồn kho: Tồn DB == Σ PN - Σ PX
Chạy: python scripts/check_inventory.py

Yêu cầu: pip install requests
Điều kiện: Docker Compose phải đang chạy (docker-compose up -d)
"""

import sys
import requests
from collections import defaultdict

BASE = "http://localhost:8000/api/v1"
HEADERS = {"X-User-ID": "36a45099-c617-5970-9e62-356c301a16bb"}


def fetch(path, page_size=500):
    url = f"{BASE}/{path}?pageSize={page_size}"
    resp = requests.get(url, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    return resp.json()


def main():
    print("🔍 Đang lấy dữ liệu từ staging...")

    # 1. Lấy tồn kho DB
    inv_rows = fetch("inventory")
    db_stock = {}  # (productId, warehouseId) -> quantity
    for r in inv_rows:
        db_stock[(r["productId"], r["warehouseId"])] = r["quantity"]

    # 2. Lấy documents (PN/PX)
    docs = fetch("documents")

    # 3. Lấy products và warehouses để tra tên
    products   = {p["id"]: p.get("name", p["id"][:8]) for p in fetch("products")}
    warehouses = {w["id"]: w.get("name", w["id"][:8]) for w in fetch("warehouses")}

    # 4. Tính Σ PN - Σ PX cho mỗi (product, warehouse)
    computed = defaultdict(int)
    pn_sum   = defaultdict(int)
    px_sum   = defaultdict(int)

    for doc in docs:
        if doc.get("status") != "confirmed":
            continue  # Chỉ tính phiếu đã xác nhận
        wh_id = doc.get("warehouseId", "")
        for item in doc.get("items", []):
            pid = item["productId"]
            qty = item["quantity"]
            key = (pid, wh_id)
            if doc["type"] == "PN":
                computed[key] += qty
                pn_sum[key]   += qty
            elif doc["type"] == "PX":
                computed[key] -= qty
                px_sum[key]   += qty

    # 5. So sánh và in bảng
    print(f"\n{'='*95}")
    print(f"{'STT':<4} {'Sản phẩm':<25} {'Kho':<18} {'Σ PN':>8} {'Σ PX':>8} {'Tính toán':>12} {'DB':>8} {'Khớp':>6}")
    print(f"{'='*95}")

    all_keys  = sorted(set(db_stock.keys()) | set(computed.keys()))
    all_match = True
    rows      = []

    for i, key in enumerate(all_keys, 1):
        pid, wh_id = key
        calc  = computed.get(key, 0)
        db    = db_stock.get(key, 0)
        ok    = "✅" if calc == db else "❌"
        if calc != db:
            all_match = False
        name  = products.get(pid,   pid[:12])[:24]
        wh    = warehouses.get(wh_id, wh_id[:12])[:17]
        pn    = pn_sum.get(key, 0)
        px    = px_sum.get(key, 0)
        rows.append((i, name, wh, pn, px, calc, db, ok))
        print(f"{i:<4} {name:<25} {wh:<18} {pn:>8} {px:>8} {calc:>12} {db:>8} {ok:>6}")

    print(f"{'='*95}")
    print(f"Tổng số dòng  : {len(all_keys)}")
    print(f"Dòng khớp ✅  : {sum(1 for r in rows if r[7]=='✅')}")
    print(f"Dòng lệch ❌  : {sum(1 for r in rows if r[7]=='❌')}")
    print(f"\nKết luận tổng : {'✅ TẤT CẢ KHỚP – Tồn kho nhất quán' if all_match else '❌ CÓ SAI LỆCH – Cần kiểm tra!'}")

    return 0 if all_match else 1


if __name__ == "__main__":
    sys.exit(main())
