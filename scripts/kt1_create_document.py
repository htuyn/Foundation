# -*- coding: utf-8 -*-
"""
KT1 - Tạo phiếu nhập kho hợp lệ
Chạy: python scripts/kt1_create_document.py --token <TOKEN> --supplier <SUPPLIER_ID>
"""
import sys
import json
import urllib.request
import urllib.error
import argparse
from datetime import datetime

BASE_URL = "http://localhost:8000"
WAREHOUSE_ID = "190d4565-f9dd-48fe-b209-0601c5ca1cdd"
PRODUCT_ID   = "0735e201-07a2-5060-a4e8-280b880371c8"

def login(email, password):
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/auth/login",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read())
    return data["accessToken"]

def get_suppliers(token):
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/suppliers",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())

def create_document(token, supplier_id):
    payload = {
        "type": "Nhập kho",
        "warehouseId": WAREHOUSE_ID,
        "supplierId": supplier_id,
        "partner": "Nhà cung cấp Test KT1",
        "lines": [
            {"productId": PRODUCT_ID, "quantity": 5, "unitCost": 373822}
        ]
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/api/v1/documents",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        return None, json.loads(e.read())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=None, help="Access token (nếu bỏ qua sẽ tự login)")
    parser.add_argument("--supplier", default=None, help="Supplier ID")
    args = parser.parse_args()

    # Tự login nếu không có token
    token = args.token
    if not token:
        print("🔑 Đang login...")
        token = login("admin@anphat.com", "Admin123!")
        print(f"✅ Login OK: {token[:30]}...")

    # Lấy supplierId nếu chưa có
    supplier_id = args.supplier
    if not supplier_id:
        print("\n📦 Đang lấy danh sách nhà cung cấp...")
        suppliers = get_suppliers(token)
        if not suppliers:
            print("❌ Không có nhà cung cấp nào trong hệ thống!")
            sys.exit(1)
        supplier_id = suppliers[0]["id"]
        print(f"✅ Dùng nhà cung cấp: {suppliers[0].get('name', suppliers[0].get('id'))} | ID: {supplier_id}")

    # Tạo phiếu nhập KT1
    print("\n📋 KT1 - Gửi phiếu nhập kho...")
    result, error = create_document(token, supplier_id)

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if result:
        print(f"✅ KT1 PASS!")
        print(f"   Mã phiếu  : {result.get('code')}")
        print(f"   Trạng thái: {result.get('status')}")
        print(f"   Thời gian  : {timestamp}")
        print(f"\n📄 Full response:")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"❌ KT1 FAIL - {timestamp}")
        print(json.dumps(error, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
