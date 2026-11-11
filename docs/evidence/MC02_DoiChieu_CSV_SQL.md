# MC02 – Biên bản Đối chiếu CSV vs SQL (Tồn kho)

> **Dự án**: Smart Warehouse – SV4  
> **Mục tiêu**: Chứng minh `Tồn kho = Σ Nhập kho (PN) − Σ Xuất kho (PX)`  
> **Ngày thực hiện**: 11/11/2026  
> **Người thực hiện**: SV4 – Nguyễn Minh Long  
> **Nhánh**: `feature/sv4-staging-rbac-testing`

---

## 1. Phương pháp đối chiếu

Hệ thống Smart Warehouse duy trì tính nhất quán tồn kho theo công thức:

$$\text{Tồn kho}_{(product, warehouse)} = \sum \text{PN} - \sum \text{PX}$$

Trong đó:
- **PN** (Phiếu Nhập): `StockDocument.type = "PN"` → tăng tồn kho
- **PX** (Phiếu Xuất): `StockDocument.type = "PX"` → giảm tồn kho
- **Tồn kho hiện tại**: bảng `Inventory.quantity`

> [!NOTE]
> Dữ liệu được lấy qua API staging tại `http://localhost:8000`. Để tái hiện, khởi động Docker Compose rồi chạy các lệnh curl bên dưới.

---

## 2. Lệnh thu thập dữ liệu

```powershell
# Lấy tồn kho hiện tại
curl http://localhost:8000/api/v1/inventory?pageSize=50 `
  -H "X-User-ID: 36a45099-c617-5970-9e62-356c301a16bb"

# Lấy toàn bộ giao dịch (phiếu kho)
curl http://localhost:8000/api/v1/documents?pageSize=200 `
  -H "X-User-ID: 36a45099-c617-5970-9e62-356c301a16bb"

# Lấy stock movements (điều chỉnh)
curl http://localhost:8000/api/v1/transactions?pageSize=200 `
  -H "X-User-ID: 36a45099-c617-5970-9e62-356c301a16bb"
```

---

## 3. Bảng đối chiếu tồn kho

> [!IMPORTANT]
> Bảng dưới được tổng hợp từ dữ liệu seed_demo.py. Sau khi khởi động staging và chạy lệnh curl ở trên, cập nhật số liệu thực tế vào cột tương ứng.

| STT | Mã sản phẩm | Tên sản phẩm | Kho | Σ Nhập (PN) | Σ Xuất (PX) | Σ Điều chỉnh | Tồn tính toán | Tồn DB (inventory) | Khớp? |
|-----|------------|--------------|-----|-------------|-------------|--------------|---------------|---------------------|-------|
| 1 | _(lấy từ API)_ | _(lấy từ API)_ | Kho A | — | — | — | — | — | ⏳ Chờ chạy |
| 2 | _(lấy từ API)_ | _(lấy từ API)_ | Kho A | — | — | — | — | — | ⏳ Chờ chạy |
| ... | ... | ... | ... | ... | ... | ... | ... | ... | ... |

> **Hướng dẫn điền bảng**: Sau khi chạy curl, dùng script Python bên dưới để tự động tính và điền.

---

## 4. Script Python đối chiếu tự động

Lưu file sau thành `scripts/check_inventory.py` và chạy khi staging đang chạy:

```python
"""
Đối chiếu tồn kho: Tồn DB == Σ PN - Σ PX
Chạy: python scripts/check_inventory.py
"""
import requests

BASE = "http://localhost:8000/api/v1"
HEADERS = {"X-User-ID": "36a45099-c617-5970-9e62-356c301a16bb"}

# 1. Lấy tồn kho DB
inv_rows = requests.get(f"{BASE}/inventory?pageSize=200", headers=HEADERS).json()
db_stock = {}  # (productId, warehouseId) -> quantity
for r in inv_rows:
    db_stock[(r["productId"], r["warehouseId"])] = r["quantity"]

# 2. Lấy tất cả documents (PN/PX)
docs = requests.get(f"{BASE}/documents?pageSize=500", headers=HEADERS).json()

# 3. Lấy products để tra tên
products = {p["id"]: p["name"] for p in requests.get(f"{BASE}/products?pageSize=200", headers=HEADERS).json()}
warehouses = {w["id"]: w["name"] for w in requests.get(f"{BASE}/warehouses?pageSize=50", headers=HEADERS).json()}

# 4. Tính Σ PN - Σ PX
computed = {}
for doc in docs:
    for item in doc.get("items", []):
        key = (item["productId"], doc["warehouseId"])
        delta = item["quantity"] if doc["type"] == "PN" else -item["quantity"]
        computed[key] = computed.get(key, 0) + delta

# 5. So sánh
print(f"{'Sản phẩm':<30} {'Kho':<20} {'Σ PN-PX':>10} {'DB':>10} {'Khớp':>6}")
print("-" * 80)
all_keys = set(db_stock.keys()) | set(computed.keys())
all_match = True
for key in sorted(all_keys):
    prod_id, wh_id = key
    calc = computed.get(key, 0)
    db   = db_stock.get(key, 0)
    ok   = "✅" if calc == db else "❌"
    if calc != db:
        all_match = False
    name = products.get(prod_id, prod_id[:8])
    wh   = warehouses.get(wh_id, wh_id[:8])
    print(f"{name:<30} {wh:<20} {calc:>10} {db:>10} {ok:>6}")

print("-" * 80)
print(f"Kết quả tổng: {'✅ TẤT CẢ KHỚP' if all_match else '❌ CÓ SAI LỆCH'}")
```

---

## 5. Kết quả chạy script

> [!NOTE]
> Chạy `python scripts/check_inventory.py` khi Docker Compose đang chạy và dán output vào đây.

```
(Chờ chạy staging – paste output tại đây)
```

**Thời điểm chạy**: ___________________  
**Người chạy**: SV4 – Nguyễn Minh Long

---

## 6. Kết luận

| Tiêu chí | Kết quả |
|---|---|
| Tổng sản phẩm đối chiếu | _(cập nhật sau khi chạy)_ |
| Số dòng khớp (✅) | _(cập nhật sau khi chạy)_ |
| Số dòng lệch (❌) | _(cập nhật sau khi chạy)_ |
| **Tính nhất quán tồn kho** | **⏳ Chờ xác nhận** |

> [!IMPORTANT]
> Nếu kết quả `❌ CÓ SAI LỆCH`: kiểm tra xem có phiếu nào chưa được `confirmed` (status != "confirmed") hoặc có điều chỉnh thủ công chưa được tính.

---

## 7. Tái hiện (Hướng dẫn kiểm thử lại)

```powershell
# 1. Đảm bảo staging đang chạy
docker-compose up -d
Start-Sleep -Seconds 15
curl http://localhost:8000/health

# 2. Chạy script đối chiếu
python scripts/check_inventory.py

# 3. Kết quả sẽ hiển thị bảng đối chiếu và kết luận
```
