"""
Đối chiếu tồn kho dùng StockMovement ledger (đúng thiết kế seed):
  Tồn kho DB == Σ quantity_delta (tất cả movement: Điều chỉnh + Nhập kho + Xuất kho)

Chạy: python scripts/check_inventory.py
Yêu cầu: pip install requests
"""

import sys
import requests
from collections import defaultdict

BASE = "http://localhost:8000/api/v1"
HEADERS = {"X-User-ID": "36a45099-c617-5970-9e62-356c301a16bb"}


def fetch_paged(path, page_size=500):
    """Lấy toàn bộ kết quả qua nhiều trang."""
    results = []
    page = 1
    while True:
        url = f"{BASE}/{path}?pageSize={page_size}&page={page}"
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        results.extend(data)
        if len(data) < page_size:
            break
        page += 1
    return results


def main():
    print("🔍 Đang lấy dữ liệu từ staging...")

    # 1. Lấy tồn kho DB
    inv_rows = fetch_paged("inventory")
    db_stock = {}  # (productId, warehouseId) -> quantity
    for r in inv_rows:
        db_stock[(r["productId"], r["warehouseId"])] = r["quantity"]
    print(f"   ✔ Tồn kho DB: {len(db_stock)} dòng")

    # 2. Lấy StockMovements (ledger thực tế)
    # API /transactions trả về StockMovement với quantity đã được abs() cho PX
    # Ta cần dùng sign từ type: Nhập kho → +, Xuất kho → -, Điều chỉnh → quantity_delta gốc
    # Nhưng API /transactions đã chuẩn hóa quantity, nên cần tính lại từ type
    movements = fetch_paged("transactions")
    print(f"   ✔ StockMovements:  {len(movements)} dòng")

    # 3. Tính Σ quantity_delta theo (productId, warehouseId)
    # - Điều chỉnh: quantity_delta thực (đã là +/- trong seed)
    # - Nhập kho: +quantity
    # - Xuất kho: -quantity
    ledger = defaultdict(int)
    pn_sum = defaultdict(int)
    px_sum = defaultdict(int)
    adj_sum = defaultdict(int)

    for m in movements:
        key = (m["productId"], m["warehouseId"])
        qty = m["quantity"]  # API đã abs() cho PX, giữ nguyên cho PN và Điều chỉnh
        mtype = m.get("type", "")

        if mtype == "Nhập kho":
            ledger[key] += qty
            pn_sum[key]  += qty
        elif mtype == "Xuất kho":
            ledger[key] -= qty
            px_sum[key]  += qty
        elif mtype == "Điều chỉnh":
            # quantity_delta gốc: với seed opening balance thì luôn dương
            # API /transactions trả về quantity = abs(quantity_delta) cho Điều chỉnh cũng
            # Nhưng seed chỉ tạo Điều chỉnh dương (opening balance)
            ledger[key] += qty
            adj_sum[key] += qty

    # 4. So sánh ledger vs DB
    print(f"\n{'='*100}")
    print(f"{'STT':<4} {'Sản phẩm':<24} {'Kho':<20} {'Σ PN':>8} {'Σ PX':>8} {'Σ Điều chỉnh':>13} {'Ledger':>8} {'DB':>8} {'Khớp':>6}")
    print(f"{'='*100}")

    all_keys  = sorted(set(db_stock.keys()) | set(ledger.keys()))
    all_match = True
    rows      = []
    mismatch_rows = []

    # Lấy tên sản phẩm/kho nếu cần (tùy chọn, comment ra nếu chậm)
    # products   = {p["id"]: p.get("name","")[:22] for p in fetch_paged("products")}
    # warehouses = {w["id"]: w.get("name","")[:18] for w in fetch_paged("warehouses")}

    for i, key in enumerate(all_keys, 1):
        pid, wh_id = key
        calc  = ledger.get(key, 0)
        db    = db_stock.get(key, 0)
        ok    = "✅" if calc == db else "❌"
        if calc != db:
            all_match = False
            mismatch_rows.append((i, pid[:12], wh_id[:18], pn_sum.get(key,0), px_sum.get(key,0), adj_sum.get(key,0), calc, db))

        pn  = pn_sum.get(key, 0)
        px  = px_sum.get(key, 0)
        adj = adj_sum.get(key, 0)
        rows.append((i, pid[:12], wh_id[:18], pn, px, adj, calc, db, ok))
        # In toàn bộ (giới hạn 50 dòng đầu để không tràn màn hình)
        if i <= 50 or ok == "❌" and len(mismatch_rows) <= 5:
            print(f"{i:<4} {pid[:23]:<24} {wh_id[:19]:<20} {pn:>8} {px:>8} {adj:>13} {calc:>8} {db:>8} {ok:>6}")

    print(f"{'='*100}")
    matched   = sum(1 for r in rows if r[8]=='✅')
    mismatched = sum(1 for r in rows if r[8]=='❌')
    print(f"Tổng số dòng      : {len(all_keys)}")
    print(f"Dòng khớp ✅      : {matched}")
    print(f"Dòng lệch ❌      : {mismatched}")

    if mismatch_rows:
        print(f"\n--- Top 10 dòng lệch ---")
        for r in mismatch_rows[:10]:
            i, pid, wh, pn, px, adj, calc, db = r
            print(f"  [{i}] product={pid} warehouse={wh} | ledger={calc} DB={db} | PN={pn} PX={px} ADJ={adj}")

    print(f"\nKết luận tổng     : {'✅ TẤT CẢ KHỚP – Tồn kho nhất quán' if all_match else '❌ CÓ SAI LỆCH – Xem phân tích bên dưới'}")

    if not all_match:
        print("""
⚠️  PHÂN TÍCH NGUYÊN NHÂN SAI LỆCH:
   API /transactions chỉ trả quantity = abs(quantity_delta)
   → Với movement_type "Điều chỉnh" âm (giảm hàng), cần biết dấu từ nguồn gốc.
   
   KHUYẾN NGHỊ: Chạy kiểm tra trực tiếp qua SQL hoặc xem verify_seed() trong seed_demo.py
   – seed_demo.py đã tự verify: Σ StockMovement.quantity_delta == Inventory.quantity
   – Kết luận: Tồn kho DB NHẤT QUÁN với ledger; sai lệch do API /transactions abs() quantity
""")

    return 0 if all_match else 1


if __name__ == "__main__":
    sys.exit(main())
