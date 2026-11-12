"""
Tạo kho mới và nhập hàng demo phục vụ bảo vệ đồ án – SV4 Smart Warehouse
Chạy: python scripts/demo_add_warehouse.py
"""

import sys
import requests

BASE_URL = "http://localhost:8000/api/v1"
ADMIN_ID = "29981161-8d43-5ddf-8ca8-021b2af4fa58"
NHAN_VIEN_ID = "36a45099-c617-5970-9e62-356c301a16bb"


def main():
    print("=" * 60)
    print("SV4 – TẠO KHO MỚI & KHỞI TẠO TỒN KHO DEMO BẢO VỆ")
    print("=" * 60)

    # 1. Kiểm tra kết nối backend
    try:
        r = requests.get("http://localhost:8000/health", timeout=5)
        if r.status_code != 200:
            raise RuntimeError(f"Status {r.status_code}")
    except Exception as e:
        print(f"❌ Không kết nối được tới Backend tại http://localhost:8000: {e}")
        print("💡 Hãy đảm bảo Docker Compose đang chạy (docker-compose up -d).")
        sys.exit(1)

    # 2. Kiểm tra xem kho demo đã có chưa
    headers_admin = {"X-User-ID": ADMIN_ID}
    wh_list = requests.get(f"{BASE_URL}/warehouses?pageSize=50", headers=headers_admin).json()
    demo_wh = next((w for w in wh_list if "Kho Demo Bảo Vệ" in w.get("name", "")), None)

    if not demo_wh:
        print("\n[1/3] Tạo kho mới qua POST /api/v1/warehouses...")
        payload_wh = {
            "name": "DEMO | Kho Demo Bảo Vệ - Tầng 2",
            "address": "Tầng 2, Tòa nhà B, Khu Công Nghệ Cao",
        }
        res_wh = requests.post(f"{BASE_URL}/warehouses", json=payload_wh, headers=headers_admin)
        if res_wh.status_code not in (200, 201):
            print(f"❌ Lỗi tạo kho: {res_wh.status_code} - {res_wh.text}")
            sys.exit(1)
        demo_wh = res_wh.json()
        print(f"✔ Đã tạo kho thành công: ID={demo_wh['id']} - Tên: {demo_wh['name']}")
    else:
        print(f"\n[1/3] Kho demo đã tồn tại: ID={demo_wh['id']} - Tên: {demo_wh['name']}")

    wh_id = demo_wh["id"]

    # 3. Lấy sản phẩm mẫu để seed tồn kho
    print("\n[2/3] Lấy danh mục sản phẩm mẫu...")
    products = requests.get(f"{BASE_URL}/products?pageSize=5", headers=headers_admin).json()
    if not products:
        print("❌ Không tìm thấy sản phẩm mẫu. Hãy chạy seed_demo.py trước.")
        sys.exit(1)

    # 4. Điều chỉnh tồn kho qua POST /inventory/adjust
    print(f"\n[3/3] Nhập tồn kho mẫu vào kho '{demo_wh['name']}'...")
    seed_quantities = [100, 250, 500]

    for i, prod in enumerate(products[:3]):
        qty = seed_quantities[i % len(seed_quantities)]
        payload_adj = {
            "productId": prod["id"],
            "warehouseId": wh_id,
            "quantity": qty,
            "reason": f"Khởi tạo hàng mẫu demo bảo vệ cho {prod['name']}",
        }
        res_adj = requests.post(f"{BASE_URL}/inventory/adjust", json=payload_adj, headers=headers_admin)
        if res_adj.status_code in (200, 201):
            print(f"   ✔ Đã nhập +{qty} sản phẩm: '{prod['name'][:30]}' vào kho demo")
        else:
            print(f"   ⚠️ Lỗi điều chỉnh tồn cho '{prod['name']}': {res_adj.text}")

    # 5. Kiểm tra kết quả qua GET /inventory
    print("\n" + "=" * 70)
    print("XÁC NHẬN TỒN KHO QUA GET /api/v1/inventory?warehouseId=" + wh_id)
    print("=" * 70)
    inv_res = requests.get(f"{BASE_URL}/inventory?warehouseId={wh_id}", headers=headers_admin).json()

    print(f"{'STT':<4} {'Sản phẩm':<35} {'Kho':<20} {'Số lượng tồn':>12}")
    print("-" * 75)
    prod_map = {p["id"]: p["name"] for p in products}
    for idx, row in enumerate(inv_res, 1):
        pname = prod_map.get(row["productId"], row["productId"][:15])[:34]
        print(f"{idx:<4} {pname:<35} {demo_wh['name'][:19]:<20} {row['quantity']:>12}")
    print("=" * 75)
    print("✅ Hoàn tất thiết lập kho demo bảo vệ!")


if __name__ == "__main__":
    main()
