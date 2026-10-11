"""Insert a deterministic, namespaced demo dataset without changing existing rows.

Run from the backend container with: python -m app.seed_demo
"""
from __future__ import annotations

import hashlib
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models import (
    AuditLog,
    Category,
    Inventory,
    Product,
    ScanEvent,
    ScannerSession,
    StockDocument,
    StockDocumentItem,
    StockMovement,
    Supplier,
    Warehouse,
)


WAREHOUSE_COUNT = 10
SUPPLIER_COUNT = 50
CATEGORY_COUNT = 30
PRODUCT_COUNT = 1_000
DOCUMENTS_PER_TYPE = 300
LINES_PER_DOCUMENT = 10
SCAN_EVENT_COUNT = 200
BATCH_SIZE = 500
SEED_KEY = "smart-warehouse-demo-seed-v1"

PRODUCT_GROUPS = (
    ("Điện tử và phụ kiện", ("Cáp và adapter", "Nguồn và pin", "Âm thanh"), ("Cáp USB-C bọc dù", "Adapter sạc nhanh", "Pin lithium", "Tai nghe chụp tai"), ("1 m", "2 m", "65 W", "100 W"), "cái"),
    ("Máy tính và văn phòng", ("Linh kiện máy tính", "Thiết bị ngoại vi", "Thiết bị trình chiếu"), ("Bàn phím cơ", "Chuột không dây", "RAM DDR5", "Màn hình văn phòng"), ("Compact", "Pro", "24 inch", "32 GB"), "cái"),
    ("Dụng cụ công nghiệp", ("Dụng cụ cầm tay", "Thiết bị đo", "Máy móc xưởng"), ("Máy khoan pin", "Bộ cờ lê", "Thước cặp điện tử", "Máy mài góc"), ("12 V", "18 V", "150 mm", "600 W"), "bộ"),
    ("Đồ gia dụng", ("Thiết bị nhà bếp", "Thiết bị vệ sinh", "Điện gia dụng"), ("Ấm đun siêu tốc", "Quạt đứng", "Máy lọc không khí", "Bộ nồi inox"), ("1.5 lít", "5 cánh", "30 m²", "3 món"), "cái"),
    ("Vật tư đóng gói", ("Thùng và hộp", "Màng và túi", "Băng keo và đệm"), ("Thùng carton 5 lớp", "Màng PE quấn pallet", "Túi chống tĩnh điện", "Băng keo đóng hàng"), ("30 x 20 cm", "50 cm", "25 x 35 cm", "100 yard"), "cuộn"),
    ("Linh kiện và phụ tùng", ("Vòng bi và truyền động", "Ốc vít và liên kết", "Phụ tùng thay thế"), ("Vòng bi công nghiệp", "Bộ ốc vít inox", "Dây curoa truyền động", "Khớp nối trục"), ("6204", "M8 x 30", "A-42", "20 mm"), "bộ"),
    ("Thiết bị mạng", ("Router và gateway", "Switch và phụ kiện", "Cáp mạng"), ("Router Wi-Fi 6", "Switch Gigabit", "Access point trần", "Cáp mạng Cat6"), ("AX1800", "8 cổng", "PoE", "305 m"), "cái"),
    ("Văn phòng phẩm", ("Giấy và sổ", "Bút và dụng cụ viết", "Lưu trữ hồ sơ"), ("Giấy in A4", "Bút bi mực xanh", "Sổ ghi chép", "Bìa hồ sơ còng"), ("70 gsm", "0.5 mm", "200 trang", "A4"), "hộp"),
    ("Vật tư bảo hộ", ("Găng tay bảo hộ", "Kính và mặt nạ", "Giày và áo bảo hộ"), ("Găng tay phủ nitrile", "Kính chống bụi", "Mặt nạ lọc bụi", "Áo phản quang"), ("Size L", "trong suốt", "N95", "Size XL"), "đôi"),
    ("Vật tư tiêu hao", ("Hóa chất vệ sinh", "Vật tư bảo trì", "Vật tư sản xuất"), ("Dung dịch vệ sinh máy", "Khăn lau công nghiệp", "Dầu bôi trơn", "Cuộn giấy nhiệt"), ("5 lít", "30 x 30 cm", "1 lít", "80 mm"), "chai"),
)

WAREHOUSE_LOCATIONS = (
    "Khu công nghiệp mẫu Bắc Ninh",
    "Cụm kho giả lập Long Biên",
    "Khu logistics mẫu Hải Phòng",
    "Kho mô phỏng Đà Nẵng",
    "Khu công nghiệp mẫu Bình Dương",
    "Trung tâm giả lập Cần Thơ",
    "Kho demo Đồng Nai",
    "Khu lưu trữ mẫu Hà Nội",
    "Trung tâm logistics giả lập Huế",
    "Kho demo Thành phố Hồ Chí Minh",
)


def stable_id(kind: str, key: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"{SEED_KEY}:{kind}:{key}")


def insert_missing(session: Session, model: type, rows: list[dict]) -> None:
    """Insert rows in bounded batches; conflicts are deliberately never updated."""
    if not rows:
        return
    table = model.__table__
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        statement = pg_insert(table).values(batch).on_conflict_do_nothing()
        session.execute(statement)


def make_base_rows(now: datetime, rng: random.Random):
    warehouse_rows = []
    for index, address in enumerate(WAREHOUSE_LOCATIONS, start=1):
        warehouse_rows.append(
            {
                "id": stable_id("warehouse", f"{index:02d}"),
                "code": f"DEMO-WH-{index:02d}",
                "name": f"DEMO | Kho {index:02d} - {address.split()[-1]}",
                "address": address,
                "manager_name": f"Quản lý mẫu {index:02d}",
                "status": "Đang hoạt động" if index != 10 else "Tạm ngưng",
            }
        )

    supplier_rows = []
    for index in range(1, SUPPLIER_COUNT + 1):
        supplier_rows.append(
            {
                "id": stable_id("supplier", f"{index:03d}"),
                "code": f"DEMO-SUP-{index:03d}",
                "name": f"DEMO | Công ty cung ứng tổng hợp {index:03d}",
                "phone": f"000-000-{index:04d}",
                "email": f"supplier-{index:03d}@demo.example",
                "address": f"Lô giả lập {index:03d}, Khu công nghiệp Demo, Việt Nam",
                "active": True,
            }
        )

    category_rows = []
    for group_index, group in enumerate(PRODUCT_GROUPS):
        group_name, subcategories, _, _, _ = group
        for subcategory_index, subcategory in enumerate(subcategories):
            index = group_index * 3 + subcategory_index + 1
            category_rows.append(
                {
                    "id": stable_id("category", f"{index:02d}"),
                    "name": f"DEMO | {group_name} - {subcategory}",
                }
            )

    product_rows = []
    product_costs: dict[int, Decimal] = {}
    category_ids = [row["id"] for row in category_rows]
    for index in range(1, PRODUCT_COUNT + 1):
        group_index = (index - 1) % len(PRODUCT_GROUPS)
        group_name, _, nouns, variants, unit = PRODUCT_GROUPS[group_index]
        category_index = group_index * 3 + ((index - 1) // len(PRODUCT_GROUPS)) % 3
        noun = nouns[((index - 1) // 10) % len(nouns)]
        variant = variants[((index - 1) // 40) % len(variants)]
        cost = Decimal(rng.randrange(1_500, 9_500_000)).quantize(Decimal("0.01"))
        product_costs[index] = cost
        product_rows.append(
            {
                "id": stable_id("product", f"{index:04d}"),
                "sku": f"DEMO-SKU-{index:06d}",
                "barcode": f"29{index:011d}",
                "name": f"DEMO | {noun} {variant} - {index:04d}",
                "category_id": category_ids[category_index],
                "unit": unit,
                "cost": cost,
                "min_stock": (5 + index % 36) if index <= 800 else (10 + index % 20),
                "status": "Đang kinh doanh" if index <= 950 else "Ngừng kinh doanh",
                "created_at": now - timedelta(days=365 + index % 120),
            }
        )
    return {
        "warehouses": warehouse_rows,
        "suppliers": supplier_rows,
        "categories": category_rows,
        "products": product_rows,
        "product_costs": product_costs,
    }


def warehouses_for_product(product_index: int) -> set[int]:
    start = (product_index * 7) % WAREHOUSE_COUNT
    return {start, (start + 1) % WAREHOUSE_COUNT, (start + 2) % WAREHOUSE_COUNT}


def create_seed_rows(now: datetime, rng: random.Random, base_rows: dict):
    warehouse_rows = base_rows["warehouses"]
    supplier_rows = base_rows["suppliers"]
    category_rows = base_rows["categories"]
    product_rows = base_rows["products"]
    costs_by_index = base_rows["product_costs"]
    warehouse_by_index = {index: row["id"] for index, row in enumerate(warehouse_rows)}
    supplier_by_index = {index: row["id"] for index, row in enumerate(supplier_rows)}
    product_by_index = {
        index: row["id"] for index, row in enumerate(product_rows, start=1)
    }
    product_index_by_id = {value: key for key, value in product_by_index.items()}
    warehouse_index_by_id = {value: key for key, value in warehouse_by_index.items()}

    inventory_quantities: dict[tuple[int, int], int] = {}
    inventory_rows = []
    movement_rows = []
    opening_number = 0
    for product_index in range(1, PRODUCT_COUNT + 1):
        for warehouse_index in sorted(warehouses_for_product(product_index)):
            if product_index <= 800:
                quantity = rng.randint(120, 800)
            elif product_index <= 950:
                quantity = rng.randint(1, 5)
            else:
                quantity = 0
            pair = (product_index, warehouse_index)
            inventory_quantities[pair] = quantity
            inventory_rows.append(
                {
                    "product_id": product_by_index[product_index],
                    "warehouse_id": warehouse_by_index[warehouse_index],
                    "quantity": quantity,
                    "location": f"Khu-{warehouse_index + 1:02d} / Kệ-{(product_index % 24) + 1:02d}",
                }
            )
            if quantity:
                opening_number += 1
                opened_at = now - timedelta(days=350 + opening_number % 10, hours=opening_number % 24)
                movement_rows.append(
                    {
                        "id": stable_id("movement-opening", f"{product_index:04d}:{warehouse_index:02d}"),
                        "code": f"DEMO-ADJ-OPEN-{opening_number:05d}",
                        "movement_type": "Điều chỉnh",
                        "product_id": product_by_index[product_index],
                        "warehouse_id": warehouse_by_index[warehouse_index],
                        "document_id": None,
                        "quantity_delta": quantity,
                        "actor_name": "DEMO | Hệ thống seed",
                        "source": "DEMO | Ghi nhận số dư đầu kỳ",
                        "created_at": opened_at,
                    }
                )

    document_rows = []
    item_rows = []
    audit_rows = []
    document_specs = []
    for document_type, prefix, type_offset in (("Nhập kho", "PN", 0), ("Xuất kho", "PX", 5)):
        for index in range(1, DOCUMENTS_PER_TYPE + 1):
            document_id = stable_id("document", f"{prefix}:{index:04d}")
            warehouse_index = (index * 7 + type_offset) % WAREHOUSE_COUNT
            created_at = now - timedelta(
                days=180 + ((index * 37 + type_offset * 13) % 151),
                hours=(index * 7 + type_offset) % 24,
                minutes=(index * 11 + type_offset) % 60,
            )
            remainder = index % 20
            status = "Bản nháp" if remainder == 18 else "Đã hủy" if remainder == 19 else "Đã xác nhận"
            supplier_index = ((index * 13 + type_offset) % SUPPLIER_COUNT) if document_type == "Nhập kho" else None
            code = f"DEMO-{prefix}-{created_at.year}-{index:04d}"
            document_rows.append(
                {
                    "id": document_id,
                    "code": code,
                    "type": document_type,
                    "warehouse_id": warehouse_by_index[warehouse_index],
                    "supplier_id": supplier_by_index[supplier_index] if supplier_index is not None else None,
                    "partner": f"DEMO | Người nhận đơn {index:04d}" if supplier_index is None else f"DEMO | Công ty cung ứng tổng hợp {supplier_index + 1:03d}",
                    "created_at": created_at,
                    "status": status,
                    "note": f"DEMO | Chứng từ {prefix} phục vụ kiểm thử nghiệp vụ kho.",
                }
            )
            eligible_products = [
                product_index
                for product_index in range(1, 801)
                if warehouse_index in warehouses_for_product(product_index)
            ]
            selected_products = rng.sample(eligible_products, LINES_PER_DOCUMENT)
            lines = []
            for product_index in selected_products:
                quantity = rng.randint(1, 12)
                item_rows.append(
                    {
                        "document_id": document_id,
                        "product_id": product_by_index[product_index],
                        "quantity": quantity,
                        "unit_cost": costs_by_index[product_index],
                    }
                )
                lines.append((product_index, quantity))
            document_specs.append(
                {
                    "id": document_id,
                    "code": code,
                    "type": document_type,
                    "warehouse_index": warehouse_index,
                    "created_at": created_at,
                    "status": status,
                    "lines": lines,
                }
            )
            audit_rows.append(
                {
                    "id": stable_id("audit", f"document-created:{prefix}:{index:04d}"),
                    "message": f"DEMO | Tạo phiếu {code}",
                    "created_at": created_at,
                    "actor_name": "DEMO | Nhân viên kho mẫu",
                }
            )
            if status == "Đã xác nhận":
                audit_rows.append(
                    {
                        "id": stable_id("audit", f"document-confirmed:{prefix}:{index:04d}"),
                        "message": f"DEMO | Xác nhận phiếu {code}",
                        "created_at": created_at + timedelta(minutes=15),
                        "actor_name": "DEMO | Quản lý kho mẫu",
                    }
                )
            elif status == "Đã hủy":
                audit_rows.append(
                    {
                        "id": stable_id("audit", f"document-cancelled:{prefix}:{index:04d}"),
                        "message": f"DEMO | Hủy phiếu nháp {code}",
                        "created_at": created_at + timedelta(minutes=20),
                        "actor_name": "DEMO | Quản lý kho mẫu",
                    }
                )

    for spec in sorted(document_specs, key=lambda item: item["created_at"]):
        if spec["status"] != "Đã xác nhận":
            continue
        for product_index, quantity in spec["lines"]:
            pair = (product_index, spec["warehouse_index"])
            delta = quantity if spec["type"] == "Nhập kho" else -quantity
            if delta < 0 and inventory_quantities[pair] < abs(delta):
                raise RuntimeError(
                    f"Seed sinh phiếu xuất vượt tồn: product={product_index}, warehouse={spec['warehouse_index']}"
                )
            inventory_quantities[pair] += delta
            movement_rows.append(
                {
                    "id": stable_id("movement-document", f"{spec['id']}:{product_index:04d}"),
                    "code": spec["code"],
                    "movement_type": spec["type"],
                    "product_id": product_by_index[product_index],
                    "warehouse_id": warehouse_by_index[spec["warehouse_index"]],
                    "document_id": spec["id"],
                    "quantity_delta": delta,
                    "actor_name": "DEMO | Nhân viên kho mẫu",
                    "source": spec["code"],
                    "created_at": spec["created_at"] + timedelta(minutes=15),
                }
            )

    for row in inventory_rows:
        product_index = product_index_by_id[row["product_id"]]
        warehouse_index = warehouse_index_by_id[row["warehouse_id"]]
        row["quantity"] = inventory_quantities[(product_index, warehouse_index)]

    audit_rows.extend(
        [
            {
                "id": stable_id("audit", f"seed-summary:{kind}"),
                "message": f"DEMO | Khởi tạo bộ dữ liệu mẫu: {description}",
                "created_at": now - timedelta(days=365),
                "actor_name": "DEMO | Hệ thống seed",
            }
            for kind, description in (
                ("warehouses", "10 kho hàng"),
                ("suppliers", "50 nhà cung cấp"),
                ("catalog", "30 danh mục và 1.000 sản phẩm"),
                ("inventory", "tồn kho và số dư đầu kỳ"),
                ("scanner", "sự kiện quét mã demo"),
            )
        ]
    )

    session_id = stable_id("scanner-session", "closed-demo-session")
    session_created_at = now - timedelta(days=30)
    scanner_session_rows = [
        {
            "id": session_id,
            "mode": "api",
            "status": "ended",
            "created_at": session_created_at,
            "expires_at": session_created_at + timedelta(minutes=10),
            "device_name": "DEMO | Máy quét cầm tay mẫu",
            "connected_at": session_created_at + timedelta(seconds=20),
            "closed_at": session_created_at + timedelta(minutes=5),
            "owner_token_hash": hashlib.sha256(f"{SEED_KEY}:owner".encode()).hexdigest(),
            "device_token_hash": hashlib.sha256(f"{SEED_KEY}:device".encode()).hexdigest(),
        }
    ]
    scanner_event_rows = []
    for index in range(1, SCAN_EVENT_COUNT + 1):
        product_index = (index * 37) % PRODUCT_COUNT + 1
        scanner_event_rows.append(
            {
                "event_id": stable_id("scan-event", f"{index:04d}"),
                "session_id": session_id,
                "barcode": f"29{product_index:011d}",
                "format": "EAN_13",
                "scanned_at": now - timedelta(days=(index * 17) % 180, minutes=index % 60),
                "device_id": f"DEMO-SCANNER-{(index % 4) + 1:02d}",
            }
        )

    return {
        "warehouses": warehouse_rows,
        "suppliers": supplier_rows,
        "categories": category_rows,
        "products": product_rows,
        "documents": document_rows,
        "items": item_rows,
        "inventory": inventory_rows,
        "movements": movement_rows,
        "audits": audit_rows,
        "scanner_sessions": scanner_session_rows,
        "scan_events": scanner_event_rows,
    }


def count_where(session: Session, model: type, criterion) -> int:
    return session.scalar(select(func.count()).select_from(model).where(criterion)) or 0


def verify_seed(session: Session, rows: dict) -> dict[str, int]:
    managed_counts = {
        "warehouses": count_where(session, Warehouse, Warehouse.code.like("DEMO-WH-%")),
        "suppliers": count_where(session, Supplier, Supplier.code.like("DEMO-SUP-%")),
        "categories": count_where(session, Category, Category.name.like("DEMO | %")),
        "products": count_where(session, Product, Product.sku.like("DEMO-SKU-%")),
        "documents": count_where(session, StockDocument, StockDocument.code.like("DEMO-%")),
        "items": count_where(
            session,
            StockDocumentItem,
            StockDocumentItem.document_id.in_(select(StockDocument.id).where(StockDocument.code.like("DEMO-%"))),
        ),
        "inventory": count_where(
            session,
            Inventory,
            and_(
                Inventory.product_id.in_(select(Product.id).where(Product.sku.like("DEMO-SKU-%"))),
                Inventory.warehouse_id.in_(select(Warehouse.id).where(Warehouse.code.like("DEMO-WH-%"))),
            ),
        ),
        "movements": count_where(session, StockMovement, StockMovement.code.like("DEMO-%")),
        "audits": count_where(session, AuditLog, AuditLog.message.like("DEMO | %")),
        "scanner_sessions": count_where(session, ScannerSession, ScannerSession.id == rows["scanner_sessions"][0]["id"]),
        "scan_events": count_where(
            session,
            ScanEvent,
            ScanEvent.session_id == rows["scanner_sessions"][0]["id"],
        ),
    }
    expected_counts = {
        "warehouses": WAREHOUSE_COUNT,
        "suppliers": SUPPLIER_COUNT,
        "categories": CATEGORY_COUNT,
        "products": PRODUCT_COUNT,
        "documents": DOCUMENTS_PER_TYPE * 2,
        "items": DOCUMENTS_PER_TYPE * 2 * LINES_PER_DOCUMENT,
        "inventory": PRODUCT_COUNT * 3,
        "scanner_sessions": 1,
        "scan_events": SCAN_EVENT_COUNT,
    }
    for key, expected in expected_counts.items():
        if key == "inventory" and managed_counts[key] >= expected:
            continue
        if managed_counts[key] != expected:
            raise RuntimeError(f"Kiểm tra seed không đạt: {key}={managed_counts[key]}, cần {expected}.")

    duplicate_skus = session.scalar(
        select(func.count()).select_from(
            select(func.lower(func.btrim(Product.sku)))
            .group_by(func.lower(func.btrim(Product.sku)))
            .having(func.count() > 1)
            .subquery()
        )
    ) or 0
    duplicate_barcodes = session.scalar(
        select(func.count()).select_from(
            select(func.btrim(Product.barcode))
            .where(Product.barcode.is_not(None), func.btrim(Product.barcode) != "")
            .group_by(func.btrim(Product.barcode))
            .having(func.count() > 1)
            .subquery()
        )
    ) or 0
    duplicate_document_codes = session.scalar(
        select(func.count()).select_from(
            select(StockDocument.code)
            .group_by(StockDocument.code)
            .having(func.count() > 1)
            .subquery()
        )
    ) or 0
    if duplicate_skus or duplicate_barcodes or duplicate_document_codes:
        raise RuntimeError("Phát hiện SKU, barcode hoặc mã chứng từ bị trùng.")

    unlinked_inbound = count_where(
        session,
        StockDocument,
        StockDocument.code.like("DEMO-%")
        & (StockDocument.type == "Nhập kho")
        & StockDocument.supplier_id.is_(None),
    )
    if unlinked_inbound:
        raise RuntimeError(f"Có {unlinked_inbound} phiếu nhập demo chưa liên kết nhà cung cấp.")

    invalid_document_movements = session.scalar(
        select(func.count())
        .select_from(StockMovement)
        .join(StockDocument, StockMovement.document_id == StockDocument.id)
        .where(
            StockDocument.code.like("DEMO-%"),
            StockDocument.status != "Đã xác nhận",
        )
    ) or 0
    if invalid_document_movements:
        raise RuntimeError("Phiếu demo chưa xác nhận lại có biến động tồn kho.")

    demo_product_ids = select(Product.id).where(Product.sku.like("DEMO-SKU-%"))
    demo_warehouse_ids = select(Warehouse.id).where(Warehouse.code.like("DEMO-WH-%"))
    movement_totals = {
        (product_id, warehouse_id): quantity
        for product_id, warehouse_id, quantity in session.execute(
            select(
                StockMovement.product_id,
                StockMovement.warehouse_id,
                func.sum(StockMovement.quantity_delta),
            )
            .where(
                StockMovement.product_id.in_(demo_product_ids),
                StockMovement.warehouse_id.in_(demo_warehouse_ids),
            )
            .group_by(StockMovement.product_id, StockMovement.warehouse_id)
        )
    }
    inventory_totals = {
        (product_id, warehouse_id): quantity
        for product_id, warehouse_id, quantity in session.execute(
            select(Inventory.product_id, Inventory.warehouse_id, Inventory.quantity).where(
                Inventory.product_id.in_(demo_product_ids),
                Inventory.warehouse_id.in_(demo_warehouse_ids),
            )
        )
    }
    for pair in inventory_totals.keys() | movement_totals.keys():
        if inventory_totals.get(pair, 0) != movement_totals.get(pair, 0):
            raise RuntimeError(f"Tồn kho không khớp ledger tại product={pair[0]}, warehouse={pair[1]}.")

    confirmed_line_count = session.scalar(
        select(func.count())
        .select_from(StockDocumentItem)
        .join(StockDocument, StockDocument.id == StockDocumentItem.document_id)
        .where(StockDocument.code.like("DEMO-%"), StockDocument.status == "Đã xác nhận")
    ) or 0
    confirmed_movement_count = session.scalar(
        select(func.count())
        .select_from(StockMovement)
        .join(StockDocument, StockDocument.id == StockMovement.document_id)
        .where(StockDocument.code.like("DEMO-%"), StockDocument.status == "Đã xác nhận")
    ) or 0
    if confirmed_line_count != confirmed_movement_count:
        raise RuntimeError(
            f"Số movement ({confirmed_movement_count}) không khớp số dòng phiếu xác nhận ({confirmed_line_count})."
        )
    managed_counts["confirmed_documents"] = count_where(
        session,
        StockDocument,
        StockDocument.code.like("DEMO-%") & (StockDocument.status == "Đã xác nhận"),
    )
    managed_counts["draft_documents"] = count_where(
        session,
        StockDocument,
        StockDocument.code.like("DEMO-%") & (StockDocument.status == "Bản nháp"),
    )
    managed_counts["cancelled_documents"] = count_where(
        session,
        StockDocument,
        StockDocument.code.like("DEMO-%") & (StockDocument.status == "Đã hủy"),
    )
    managed_counts["confirmed_document_movements"] = confirmed_movement_count
    return managed_counts


def main() -> None:
    now = datetime.now(timezone.utc)
    rng = random.Random(20261010)
    base_rows = make_base_rows(now, rng)
    rows = create_seed_rows(now, rng, base_rows)

    with SessionLocal.begin() as session:
        insert_missing(session, Warehouse, rows["warehouses"])
        insert_missing(session, Supplier, rows["suppliers"])
        insert_missing(session, Category, rows["categories"])
        insert_missing(session, Product, rows["products"])
        insert_missing(session, StockDocument, rows["documents"])
        insert_missing(session, StockDocumentItem, rows["items"])
        insert_missing(session, Inventory, rows["inventory"])
        insert_missing(session, StockMovement, rows["movements"])
        insert_missing(session, AuditLog, rows["audits"])
        insert_missing(session, ScannerSession, rows["scanner_sessions"])
        insert_missing(session, ScanEvent, rows["scan_events"])
        managed_counts = verify_seed(session, rows)

    print("Seed DEMO hoàn tất; dữ liệu ngoài namespace DEMO không bị cập nhật/xóa.")
    for key in (
        "warehouses",
        "suppliers",
        "categories",
        "products",
        "inventory",
        "documents",
        "confirmed_documents",
        "draft_documents",
        "cancelled_documents",
        "items",
        "movements",
        "confirmed_document_movements",
        "audits",
        "scanner_sessions",
        "scan_events",
    ):
        print(f"{key}={managed_counts[key]}")


if __name__ == "__main__":
    main()
