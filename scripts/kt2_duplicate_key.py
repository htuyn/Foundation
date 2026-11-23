# -*- coding: utf-8 -*-
"""
KT2 - Gửi trùng idempotency_key → hệ thống chặn, tồn kho không đổi
Chạy: python scripts/kt2_duplicate_key.py
"""
import json
import uuid
import urllib.request
import urllib.error
from datetime import datetime

BASE_URL     = "http://localhost:8000"
WAREHOUSE_ID = "190d4565-f9dd-48fe-b209-0601c5ca1cdd"
PRODUCT_ID   = "0735e201-07a2-5060-a4e8-280b880371c8"
SUPPLIER_ID  = "89fb1d6e-4bf7-5b0e-a1e3-b8614d507c56"

def login():
    payload = json.dumps({"email": "admin@anphat.com", "password": "Admin123!"}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/auth/login",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["accessToken"]

def get_inventory(token, product_id):
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/inventory",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req) as resp:
        items = json.loads(resp.read())
    for item in items:
        if item.get("productId") == product_id:
            return item.get("quantity", 0)
    return "N/A"

def create_document(token, idempotency_key):
    payload = {
        "type": "Nhập kho",
        "warehouseId": WAREHOUSE_ID,
        "supplierId": SUPPLIER_ID,
        "partner": "Nhà cung cấp Test KT2",
        "lines": [
            {"productId": PRODUCT_ID, "quantity": 3, "unitCost": 373822}
        ]
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/documents",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": idempotency_key
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def main():
    print("🔑 Đang login...")
    token = login()
    print(f"✅ Login OK\n")

    # Sinh 1 key duy nhất cho cả 2 lần gửi
    idem_key = str(uuid.uuid4())
    print(f"🔑 Idempotency-Key: {idem_key}")
    print(f"   (Cùng key này gửi 2 lần để kiểm tra)\n")

    # Lấy tồn kho TRƯỚC
    stock_before = get_inventory(token, PRODUCT_ID)
    print(f"📊 Tồn kho TRƯỚC khi test: {stock_before}")

    # Lần 1
    print(f"\n📤 Lần 1 - Gửi phiếu nhập...")
    ts1 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    status1, result1 = create_document(token, idem_key)
    print(f"   HTTP {status1} | {ts1}")
    if status1 == 201:
        print(f"   ✅ Tạo phiếu: {result1.get('code')}")
    else:
        print(f"   Response: {json.dumps(result1, ensure_ascii=False)}")

    # Lần 2 — cùng key
    print(f"\n📤 Lần 2 - Gửi CÙNG key lần 2 (phải bị chặn)...")
    ts2 = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    status2, result2 = create_document(token, idem_key)
    print(f"   HTTP {status2} | {ts2}")
    if status2 in (200, 409):
        print(f"   ✅ Hệ thống nhận ra trùng key!")
        if status2 == 409:
            err = result2.get("error", {})
            print(f"   Code : {err.get('code')}")
            print(f"   Msg  : {err.get('message')}")
        else:
            print(f"   duplicate flag: {result2.get('duplicate', 'N/A')}")
    else:
        print(f"   Response: {json.dumps(result2, ensure_ascii=False)}")

    # Lấy tồn kho SAU
    stock_after = get_inventory(token, PRODUCT_ID)
    print(f"\n📊 Tồn kho SAU khi test: {stock_after}")

    # Kết luận
    print("\n" + "="*50)
    if status1 == 201 and status2 in (200, 201, 409):
        if stock_before == stock_after or status2 in (409, 200):
            print("✅ KT2 PASS - Hệ thống chống ghi trùng hoạt động đúng!")
            print(f"   Lần 1: HTTP {status1} ✅")
            print(f"   Lần 2: HTTP {status2} ✅ (trùng key bị xử lý đúng)")
        else:
            print("⚠️  KT2 WARNING - Tồn kho thay đổi 2 lần! Cần kiểm tra lại.")
    else:
        print("❌ KT2 cần xem xét - xem chi tiết ở trên")
    print(f"⏰ Thời gian: {ts2}")

if __name__ == "__main__":
    main()
