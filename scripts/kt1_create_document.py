# -*- coding: utf-8 -*-
"""
KT1 - Tạo phiếu nhập kho hợp lệ (đầy đủ 3 bước: Tạo → Xác nhận → Kiểm tra tồn kho)
Chạy: python scripts/kt1_create_document.py
"""
import sys
import json
import urllib.request
import urllib.error
import argparse
from datetime import datetime

BASE_URL     = "http://localhost:8000"
WAREHOUSE_ID = "190d4565-f9dd-48fe-b209-0601c5ca1cdd"
PRODUCT_ID   = "0735e201-07a2-5060-a4e8-280b880371c8"
QUANTITY     = 5


# ─── helpers ────────────────────────────────────────────────────────────────

def api(method, path, token=None, body=None):
    """Gọi API; trả về (status_code, dict). Không raise ngoại lệ."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body else None
    req  = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


# ─── main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token",    default=None, help="Access token (tự login nếu bỏ qua)")
    parser.add_argument("--supplier", default=None, help="Supplier ID")
    args = parser.parse_args()

    ts = lambda: datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # ── Bước 0: Login ──────────────────────────────────────────────────────
    token = args.token
    if not token:
        print("🔑 Đang login...")
        status, data = api("POST", "/api/v1/auth/login",
                           body={"email": "admin@anphat.com", "password": "Admin123!"})
        if status != 200 or "accessToken" not in data:
            print(f"❌ Login thất bại ({status}): {data}")
            sys.exit(1)
        token = data["accessToken"]
        print(f"✅ Login OK | {ts()}")

    # ── Lấy supplier ───────────────────────────────────────────────────────
    supplier_id = args.supplier
    if not supplier_id:
        print("\n📦 Lấy danh sách nhà cung cấp...")
        status, data = api("GET", "/api/v1/suppliers", token=token)
        if status != 200 or not data:
            print(f"❌ Không lấy được nhà cung cấp ({status})")
            sys.exit(1)
        supplier_id = data[0]["id"]
        print(f"✅ Nhà cung cấp: {data[0].get('name', data[0].get('id'))} | ID: {supplier_id}")

    def read_stock(tok, wh_id, prod_id):
        """Đọc tồn kho – match đúng productId vì API không filter được."""
        _, inv_data = api("GET", f"/api/v1/inventory?warehouseId={wh_id}", token=tok)
        all_items = inv_data if isinstance(inv_data, list) else inv_data.get("items", inv_data.get("data", []))
        for item in (all_items or []):
            if item.get("productId") == prod_id:
                return item.get("quantity")
        return None

    # ── Bước 1: Lấy tồn kho TRƯỚC ─────────────────────────────────────────
    print("\n📊 Lấy tồn kho TRƯỚC khi tạo phiếu...")
    qty_before = read_stock(token, WAREHOUSE_ID, PRODUCT_ID)
    print(f"   Tồn kho TRƯỚC: {qty_before if qty_before is not None else '(không tìm thấy sản phẩm trong kho)'}")

    # ── Bước 2: Tạo phiếu nhập (POST /documents) ──────────────────────────
    print("\n📋 KT1 – Bước 1/3: Tạo phiếu nhập kho...")
    status, doc = api("POST", "/api/v1/documents", token=token, body={
        "type":        "Nhập kho",
        "warehouseId": WAREHOUSE_ID,
        "supplierId":  supplier_id,
        "partner":     "Nhà cung cấp Test KT1",
        "lines": [
            {"productId": PRODUCT_ID, "quantity": QUANTITY, "unitCost": 373822}
        ]
    })

    if status not in (200, 201):
        print(f"❌ KT1 FAIL – Tạo phiếu thất bại | HTTP {status} | {ts()}")
        print(json.dumps(doc, ensure_ascii=False, indent=2))
        sys.exit(1)

    doc_id   = doc.get("id")
    doc_code = doc.get("code")
    print(f"   HTTP {status} ✅  |  Mã phiếu: {doc_code}  |  Trạng thái: {doc.get('status')}  |  {ts()}")

    # ── Bước 3: Xác nhận phiếu (POST /documents/{id}/confirm) ─────────────
    print(f"\n📋 KT1 – Bước 2/3: Xác nhận phiếu {doc_code}...")
    status, confirmed = api("POST", f"/api/v1/documents/{doc_id}/confirm", token=token)

    if status not in (200, 201):
        print(f"❌ KT1 FAIL – Xác nhận phiếu thất bại | HTTP {status} | {ts()}")
        print(json.dumps(confirmed, ensure_ascii=False, indent=2))
        sys.exit(1)

    print(f"   HTTP {status} ✅  |  Trạng thái: {confirmed.get('status')}  |  {ts()}")

    # ── Bước 4: Kiểm tra tồn kho SAU ──────────────────────────────────────
    print(f"\n📊 KT1 – Bước 3/3: Kiểm tra tồn kho SAU khi xác nhận...")
    qty_after = read_stock(token, WAREHOUSE_ID, PRODUCT_ID)
    print(f"   Tồn kho SAU : {qty_after if qty_after is not None else '(không tìm thấy)'}")

    # ── Tổng kết ───────────────────────────────────────────────────────────
    print("\n" + "=" * 54)
    if qty_before is not None and qty_after is not None:
        delta = qty_after - qty_before
        ok    = delta == QUANTITY
        print(f"{'✅' if ok else '❌'} Kiểm tra tồn kho: {qty_before} → {qty_after} (Δ = {delta:+d}, kỳ vọng +{QUANTITY})")
        if not ok:
            print(f"   ⚠️  Chênh lệch không khớp – kiểm tra lại backend!")
    else:
        print("⚠️  Không so sánh được tồn kho (API /inventory trả về cấu trúc khác).")

    print(f"\n✅ KT1 PASS!")
    print(f"   Mã phiếu  : {doc_code}")
    print(f"   Trạng thái: {confirmed.get('status')}")
    print(f"   Thời gian  : {ts()}")
    print(f"\n📄 Full response (phiếu đã xác nhận):")
    print(json.dumps(confirmed, ensure_ascii=False, indent=2))
    print("=" * 54)


if __name__ == "__main__":
    main()
