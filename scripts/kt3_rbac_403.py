# -*- coding: utf-8 -*-
"""
KT3 - Kiểm thử phân quyền: tài khoản Chỉ xem bị 403 khi tạo phiếu
Chạy: python scripts/kt3_rbac_403.py
"""
import json
import urllib.request
import urllib.error
from datetime import datetime

BASE_URL     = "http://localhost:8000"
WAREHOUSE_ID = "190d4565-f9dd-48fe-b209-0601c5ca1cdd"
PRODUCT_ID   = "0735e201-07a2-5060-a4e8-280b880371c8"
SUPPLIER_ID  = "89fb1d6e-4bf7-5b0e-a1e3-b8614d507c56"

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
    return data["accessToken"], data["user"]["role"]

def try_create_document(token):
    payload = {
        "type": "Nhập kho",
        "warehouseId": WAREHOUSE_ID,
        "supplierId": SUPPLIER_ID,
        "partner": "Test KT3 viewer",
        "lines": [
            {"productId": PRODUCT_ID, "quantity": 1, "unitCost": 373822}
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
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def main():
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("=" * 55)
    print("KT3 - Kiểm thử phân quyền RBAC (Chỉ xem → 403)")
    print("=" * 55)

    # --- Test 3a: Viewer bị 403 ---
    print("\n🔑 Login tài khoản VIEWER (Chỉ xem)...")
    viewer_token, viewer_role = login("viewer@anphat.com", "Viewer123!")
    print(f"✅ Login OK | Vai trò: {viewer_role}")

    print("\n📤 Thử tạo phiếu nhập bằng tài khoản Chỉ xem...")
    status, result = try_create_document(viewer_token)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"   HTTP {status} | {ts}")
    print(f"   Response: {json.dumps(result, ensure_ascii=False, indent=2)}")

    print("\n--- Kết quả KT3a ---")
    if status == 403:
        err = result.get("error", {})
        print(f"✅ KT3a PASS - Tài khoản Chỉ xem bị chặn đúng!")
        print(f"   Mã lỗi : {err.get('code', 'N/A')}")
        print(f"   Thông báo: {err.get('message', 'N/A')}")
    else:
        print(f"❌ KT3a FAIL - Mong đợi 403 nhưng nhận được {status}")

    # --- Test 3b: Admin vẫn tạo được ---
    print("\n🔑 Login tài khoản ADMIN (đối chiếu)...")
    admin_token, admin_role = login("admin@anphat.com", "Admin123!")
    print(f"✅ Login OK | Vai trò: {admin_role}")

    print("\n📤 Thử tạo phiếu nhập bằng tài khoản Admin (phải thành công)...")
    status_admin, result_admin = try_create_document(admin_token)
    print(f"   HTTP {status_admin} | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    print("\n--- Kết quả KT3b ---")
    if status_admin == 201:
        print(f"✅ KT3b PASS - Admin tạo phiếu thành công: {result_admin.get('code')}")
    else:
        print(f"⚠️  KT3b: {status_admin} - {json.dumps(result_admin, ensure_ascii=False)}")

    # --- Tổng kết ---
    print("\n" + "=" * 55)
    if status == 403 and status_admin == 201:
        print("✅ KT3 PASS HOÀN TOÀN!")
        print(f"   Viewer → HTTP 403 FORBIDDEN ✅")
        print(f"   Admin  → HTTP 201 Created   ✅")
    else:
        print("❌ KT3 cần xem xét lại")
    print(f"⏰ Thời gian: {timestamp}")

if __name__ == "__main__":
    main()
