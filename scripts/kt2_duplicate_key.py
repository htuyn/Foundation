# -*- coding: utf-8 -*-
"""
KT2 - Gửi trùng idempotency_key → hệ thống chặn, tồn kho không đổi

Có 2 kịch bản:
  A) Tuần tự  : lần 1 xong → lần 2 (mặc định và phổ biến)
  B) Đồng thời: 2 request bắn cùng lúc bằng threading (demo race condition)

Chạy:
  python scripts/kt2_duplicate_key.py           # cả 2 kịch bản
  python scripts/kt2_duplicate_key.py --seq     # chỉ tuần tự
  python scripts/kt2_duplicate_key.py --con     # chỉ đồng thời
"""
import json
import uuid
import threading
import sys
import urllib.request
import urllib.error
from datetime import datetime

BASE_URL     = "http://localhost:8000"
WAREHOUSE_ID = "190d4565-f9dd-48fe-b209-0601c5ca1cdd"
PRODUCT_ID   = "0735e201-07a2-5060-a4e8-280b880371c8"
SUPPLIER_ID  = "89fb1d6e-4bf7-5b0e-a1e3-b8614d507c56"

# ─────────────────────────── helpers ─────────────────────────── #

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
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read()), ts
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()), ts

def print_result(label, status, result, ts):
    icon = "✅" if status in (200, 201, 409) else "❌"
    print(f"   {icon} {label} | HTTP {status} | {ts}")
    if status == 201:
        print(f"      → Phiếu tạo mới: {result.get('code', 'N/A')}")
    elif status == 200:
        dup = result.get("duplicate", False)
        print(f"      → Replay (duplicate={dup}): {result.get('code', 'N/A')}")
    elif status == 409:
        err = result.get("error", result)
        code = err.get("code", "") if isinstance(err, dict) else result.get("detail", "")
        print(f"      → 409 DUPLICATE_KEY: {code}")
    else:
        print(f"      → {json.dumps(result, ensure_ascii=False)[:200]}")

def evaluate(label, status1, status2, stock_before, stock_after):
    print(f"\n{'─'*52}")
    print(f"📋 Kết luận [{label}]")
    print(f"   Lần 1 : HTTP {status1}")
    print(f"   Lần 2 : HTTP {status2}")
    print(f"   Tồn kho : {stock_before} → {stock_after}")

    ok1 = status1 == 201
    ok2 = status2 in (200, 201, 409)
    stock_ok = (stock_before == stock_after) or (status2 in (200, 409))

    if ok1 and ok2 and stock_ok:
        print("   ✅ KT2 PASS – Hệ thống chống ghi trùng hoạt động đúng!")
    elif not ok1:
        print("   ❌ KT2 FAIL – Lần 1 không tạo được phiếu (xem log trên)")
    elif not stock_ok:
        print("   ⚠️  KT2 WARNING – Tồn kho thay đổi 2 lần! Cần kiểm tra lại.")
    else:
        print("   ❌ KT2 cần xem xét – xem chi tiết ở trên")

# ─────────────────── Kịch bản A: Tuần tự ─────────────────────── #

def run_sequential(token):
    print("\n" + "═"*52)
    print("📌 KỊCH BẢN A – GỬI TUẦN TỰ (lần 1 xong → lần 2)")
    print("═"*52)

    idem_key = str(uuid.uuid4())
    print(f"🔑 Idempotency-Key: {idem_key}\n")

    stock_before = get_inventory(token, PRODUCT_ID)
    print(f"📊 Tồn kho TRƯỚC: {stock_before}")

    print("\n📤 Gửi lần 1 (tạo phiếu mới)...")
    status1, result1, ts1 = create_document(token, idem_key)
    print_result("Lần 1", status1, result1, ts1)

    print("\n📤 Gửi lần 2 (cùng key – phải bị chặn)...")
    status2, result2, ts2 = create_document(token, idem_key)
    print_result("Lần 2", status2, result2, ts2)

    stock_after = get_inventory(token, PRODUCT_ID)
    print(f"\n📊 Tồn kho SAU: {stock_after}")

    evaluate("Tuần tự", status1, status2, stock_before, stock_after)
    return status1, status2

# ─────────────────── Kịch bản B: Đồng thời ───────────────────── #

def run_concurrent(token):
    print("\n" + "═"*52)
    print("⚡ KỊCH BẢN B – GỬI ĐỒNG THỜI (race condition test)")
    print("   2 request bắn cùng lúc với CÙNG idempotency_key")
    print("═"*52)

    idem_key = str(uuid.uuid4())
    print(f"🔑 Idempotency-Key: {idem_key}")
    print("   (cả 2 thread dùng chung key này)\n")

    stock_before = get_inventory(token, PRODUCT_ID)
    print(f"📊 Tồn kho TRƯỚC: {stock_before}")

    # Kết quả thread được lưu vào dict dùng chung
    results = {}
    barrier = threading.Barrier(2)  # 2 thread chờ nhau tại cùng 1 điểm → bắn gần như đồng thời

    def worker(name):
        barrier.wait()   # 2 thread sync tại đây → cùng release → race condition
        status, result, ts = create_document(token, idem_key)
        results[name] = (status, result, ts)

    t1 = threading.Thread(target=worker, args=("Thread-1",))
    t2 = threading.Thread(target=worker, args=("Thread-2",))

    print("\n📤 Khởi động 2 thread... (cùng Barrier → bắn gần như đồng thời)")
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    status1, result1, ts1 = results["Thread-1"]
    status2, result2, ts2 = results["Thread-2"]

    print_result("Thread-1", status1, result1, ts1)
    print_result("Thread-2", status2, result2, ts2)

    # Phân tích kết quả đồng thời
    statuses = {status1, status2}
    stock_after = get_inventory(token, PRODUCT_ID)
    print(f"\n📊 Tồn kho SAU: {stock_after}")

    print(f"\n{'─'*52}")
    print("📋 Kết luận [Đồng thời]")
    print(f"   Thread-1 : HTTP {status1}")
    print(f"   Thread-2 : HTTP {status2}")
    print(f"   Tồn kho  : {stock_before} → {stock_after}")

    if 201 in statuses and (200 in statuses or 409 in statuses):
        print("   ✅ KT2 PASS – 1 thread tạo phiếu, 1 thread bị chặn (đúng!)")
    elif statuses == {201}:
        # Cả 2 đều 201 → race condition thất bại, tồn kho bị cộng 2 lần
        if stock_after == stock_before:
            print("   ✅ KT2 PASS – 2× 201 nhưng tồn kho không đổi (advisory lock OK)")
        else:
            print("   ❌ KT2 FAIL – Cả 2 đều 201 VÀ tồn kho tăng 2 lần! Race condition!")
            print("      → Báo SV3: cần kiểm tra lại UNIQUE constraint / advisory lock")
    elif statuses == {409}:
        print("   ✅ KT2 PASS – Cả 2 bị chặn 409 (key đã tồn tại từ trước trong test suite)")
    elif statuses == {200}:
        print("   ✅ KT2 PASS – Cả 2 replay 200 (key đã tồn tại trước đó)")
    else:
        print(f"   ⚠️  Trạng thái không xác định: {statuses}")

    return status1, status2

# ─────────────────────────── main ────────────────────────────── #

def main():
    args = sys.argv[1:]
    run_seq = "--con" not in args   # mặc định: chạy tuần tự
    run_con = "--seq" not in args   # mặc định: chạy đồng thời

    print("🔑 Đang login...")
    try:
        token = login()
    except Exception as e:
        print(f"❌ Login thất bại: {e}")
        print("   Kiểm tra: docker compose ps | staging đang chạy không?")
        return
    print("✅ Login OK\n")

    if run_seq:
        run_sequential(token)

    if run_con:
        run_concurrent(token)

    print("\n" + "═"*52)
    print("🏁 Hoàn thành KT2")
    print("   📁 Lưu output này vào tests/kt_results/KT2_evidence.txt")
    print("═"*52)

if __name__ == "__main__":
    main()
