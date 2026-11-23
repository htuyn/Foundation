import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import UUID, uuid4
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_db
from app.core.rbac import get_current_user
from app.db.session import engine
from app.main import app
from app.models import User


@pytest.fixture(autouse=True)
def authenticated_business_api_requests():
    previous = app.dependency_overrides.get(get_current_user)
    test_user = User(id=uuid4(), name="Integration admin", email="integration@example.test", role="Quản trị viên", active=True)
    app.dependency_overrides[get_current_user] = lambda: test_user
    try:
        yield
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_product_crud_against_postgres_rolls_back_test_data() -> None:
    connection = engine.connect()
    transaction = connection.begin()
    test_sessions = sessionmaker(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    def override_get_db():
        with test_sessions() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    previous_override = app.dependency_overrides.get(get_db)
    previous_user_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex
    acting_user = User(
        id=uuid4(),
        name=f"Integration admin {suffix}",
        email=f"admin_{suffix}@example.test",
        role="Quản trị viên",
        active=True,
    )
    with test_sessions() as db:
        db.add(acting_user)
        db.commit()
    app.dependency_overrides[get_current_user] = lambda: acting_user

    try:
        with TestClient(app) as client:
            category_response = client.post("/api/v1/categories", json={"name": f"Test {suffix}"})
            assert category_response.status_code == 201
            category = category_response.json()["name"]
            payload = {
                "barcode": f"  TEST-BARCODE-{suffix}  ",
                "name": f"Product test {suffix}",
                "category": category,
                "unit": "chiếc",
                "cost": 1200,
                "minStock": 1,
                "status": "Đang kinh doanh",
            }

            create_response = client.post("/api/v1/products", json=payload)
            assert create_response.status_code == 201
            product_id = create_response.json()["id"]
            generated_sku = create_response.json()["sku"]
            assert generated_sku.startswith("SP-")
            assert len(generated_sku) >= 9
            assert create_response.json()["barcode"] == f"TEST-BARCODE-{suffix}"
            assert client.get(f"/api/v1/products/{product_id}").json()["name"] == payload["name"]

            second_payload = {
                **payload,
                "sku": None,
                "barcode": "   ",
                "name": f"Second product test {suffix}",
            }
            second_response = client.post("/api/v1/products", json=second_payload)
            assert second_response.status_code == 201
            assert second_response.json()["sku"] != generated_sku
            assert second_response.json()["barcode"] == ""

            payload["name"] = f"Updated product {suffix}"
            payload["sku"] = f"CUSTOM-{suffix}"
            payload["barcode"] = f"TEST-BARCODE-{suffix}"
            update_response = client.put(f"/api/v1/products/{product_id}", json=payload)
            assert update_response.status_code == 200
            assert update_response.json()["name"] == payload["name"]
            assert update_response.json()["sku"] == payload["sku"]

            delete_response = client.delete(f"/api/v1/products/{product_id}")
            assert delete_response.status_code == 204
            assert client.get(f"/api/v1/products/{product_id}").status_code == 404
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        transaction.rollback()
        connection.close()


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_product_sku_suggestions_are_unique_under_concurrent_requests() -> None:
    def request_suggestion() -> str:
        with TestClient(app) as client:
            response = client.get("/api/v1/products/next-sku")
            assert response.status_code == 200
            return response.json()["sku"]

    with ThreadPoolExecutor(max_workers=2) as pool:
        suggestions = list(pool.map(lambda _index: request_suggestion(), range(2)))

    assert len(set(suggestions)) == 2
    assert all(value.startswith("SP-") and value[3:].isdigit() for value in suggestions)


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_product_sku_and_barcode_conflicts_return_friendly_errors() -> None:
    connection = engine.connect()
    transaction = connection.begin()
    test_sessions = sessionmaker(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    def override_get_db():
        with test_sessions() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    previous_override = app.dependency_overrides.get(get_db)
    previous_user_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex
    acting_user = User(
        id=uuid4(),
        name=f"Integration admin {suffix}",
        email=f"admin_{suffix}@example.test",
        role="Quản trị viên",
        active=True,
    )
    with test_sessions() as db:
        db.add(acting_user)
        db.commit()
    app.dependency_overrides[get_current_user] = lambda: acting_user

    try:
        with TestClient(app) as client:
            category_response = client.post("/api/v1/categories", json={"name": f"Test {suffix}"})
            assert category_response.status_code == 201
            base_payload = {
                "sku": f"SKU-{suffix}",
                "barcode": f"BAR-{suffix}",
                "name": f"Product {suffix}",
                "category": category_response.json()["name"],
                "unit": "chiếc",
                "cost": 100,
                "minStock": 1,
                "status": "Đang kinh doanh",
            }
            created = client.post("/api/v1/products", json=base_payload)
            assert created.status_code == 201
            lookup_response = client.get("/api/v1/products/lookup", params={"code": base_payload["barcode"]})
            assert lookup_response.status_code == 200
            assert lookup_response.json()["id"] == created.json()["id"]
            barcode_only_lookup = client.get("/api/v1/products/lookup", params={"barcode": base_payload["barcode"]})
            assert barcode_only_lookup.status_code == 200
            assert barcode_only_lookup.json()["id"] == created.json()["id"]
            sku_is_not_barcode = client.get("/api/v1/products/lookup", params={"barcode": base_payload["sku"]})
            assert sku_is_not_barcode.status_code == 404
            missing_lookup = client.get("/api/v1/products/lookup", params={"code": f"MISSING-{suffix}"})
            assert missing_lookup.status_code == 404
            assert missing_lookup.json()["error"]["code"] == "PRODUCT_NOT_FOUND"
            other_payload = {
                **base_payload,
                "sku": f"SECOND-SKU-{suffix}",
                "barcode": f"SECOND-BAR-{suffix}",
                "name": f"Second product {suffix}",
            }
            other = client.post("/api/v1/products", json=other_payload)
            assert other.status_code == 201

            duplicate_sku = {**base_payload, "sku": base_payload["sku"].lower(), "barcode": f"OTHER-{suffix}"}
            sku_response = client.post("/api/v1/products", json=duplicate_sku)
            assert sku_response.status_code == 409
            assert sku_response.json()["error"]["code"] == "DUPLICATE_SKU"

            duplicate_barcode = {**base_payload, "sku": f"OTHER-SKU-{suffix}", "barcode": f" {base_payload['barcode']} "}
            barcode_response = client.post("/api/v1/products", json=duplicate_barcode)
            assert barcode_response.status_code == 409
            assert barcode_response.json()["error"]["code"] == "DUPLICATE_BARCODE"

            update_barcode_response = client.put(
                f"/api/v1/products/{other.json()['id']}",
                json={**other_payload, "barcode": base_payload["barcode"]},
            )
            assert update_barcode_response.status_code == 409
            assert update_barcode_response.json()["error"]["code"] == "DUPLICATE_BARCODE"

            same_product = client.put(f"/api/v1/products/{created.json()['id']}", json=base_payload)
            assert same_product.status_code == 200
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        transaction.rollback()
        connection.close()


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_category_warehouse_and_supplier_crud_rolls_back_test_data() -> None:
    connection = engine.connect()
    transaction = connection.begin()
    test_sessions = sessionmaker(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    def override_get_db():
        with test_sessions() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    previous_override = app.dependency_overrides.get(get_db)
    previous_user_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex
    acting_user = User(
        id=uuid4(),
        name=f"Integration admin {suffix}",
        email=f"admin_{suffix}@example.test",
        role="Quản trị viên",
        active=True,
    )
    with test_sessions() as db:
        db.add(acting_user)
        db.commit()
    app.dependency_overrides[get_current_user] = lambda: acting_user

    try:
        with TestClient(app) as client:
            category = f"Test {suffix}"
            category_response = client.post("/api/v1/categories", json={"name": category})
            assert category_response.status_code == 201
            renamed = f"Renamed {suffix}"
            rename_response = client.patch(f"/api/v1/categories/by-name/{quote(category)}", json={"name": renamed})
            assert rename_response.status_code == 200
            assert client.delete(f"/api/v1/categories/by-name/{quote(renamed)}").status_code == 204

            warehouse_payload = {
                "code": f"TEST-{suffix}",
                "name": f"Test warehouse {suffix}",
                "address": "Test address",
                "manager": "Test manager",
                "status": "Đang hoạt động",
            }
            warehouse_response = client.post("/api/v1/warehouses", json=warehouse_payload)
            assert warehouse_response.status_code == 201
            warehouse_id = warehouse_response.json()["id"]
            warehouse_payload["name"] = f"Updated warehouse {suffix}"
            assert client.put(f"/api/v1/warehouses/{warehouse_id}", json=warehouse_payload).status_code == 200
            assert client.delete(f"/api/v1/warehouses/{warehouse_id}").status_code == 204

            supplier_payload = {
                "code": f"TEST-{suffix}",
                "name": f"Test supplier {suffix}",
                "phone": "0900000000",
                "email": f"test-{suffix}@example.invalid",
                "address": "Test address",
                "active": True,
            }
            supplier_response = client.post("/api/v1/suppliers", json=supplier_payload)
            assert supplier_response.status_code == 201
            supplier_id = supplier_response.json()["id"]
            supplier_payload["name"] = f"Updated supplier {suffix}"
            assert client.put(f"/api/v1/suppliers/{supplier_id}", json=supplier_payload).status_code == 200
            assert client.delete(f"/api/v1/suppliers/{supplier_id}").status_code == 204
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        transaction.rollback()
        connection.close()


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_warehouse_delete_rejects_warehouse_with_stock() -> None:
    connection = engine.connect()
    transaction = connection.begin()
    test_sessions = sessionmaker(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    def override_get_db():
        with test_sessions() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    previous_override = app.dependency_overrides.get(get_db)
    previous_user_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex
    acting_user = User(
        id=uuid4(),
        name=f"Integration admin {suffix}",
        email=f"admin_{suffix}@example.test",
        role="Quản trị viên",
        active=True,
    )
    with test_sessions() as db:
        db.add(acting_user)
        db.commit()
    app.dependency_overrides[get_current_user] = lambda: acting_user

    try:
        with TestClient(app) as client:
            category_response = client.post("/api/v1/categories", json={"name": f"Test {suffix}"})
            warehouse_response = client.post(
                "/api/v1/warehouses",
                json={
                    "code": f"TEST-{suffix}",
                    "name": f"Test warehouse {suffix}",
                    "address": "Test address",
                    "manager": "Test manager",
                    "status": "Đang hoạt động",
                },
            )
            assert category_response.status_code == 201
            assert warehouse_response.status_code == 201
            product_response = client.post(
                "/api/v1/products",
                json={
                    "sku": f"TEST-{suffix}",
                    "barcode": None,
                    "name": f"Test product {suffix}",
                    "category": category_response.json()["name"],
                    "unit": "chiếc",
                    "cost": 100,
                    "minStock": 1,
                    "status": "Đang kinh doanh",
                },
            )
            assert product_response.status_code == 201
            adjustment_response = client.post(
                "/api/v1/inventory/adjust",
                json={
                    "productId": product_response.json()["id"],
                    "warehouseId": warehouse_response.json()["id"],
                    "quantity": 1,
                    "reason": "Integration test",
                },
            )
            assert adjustment_response.status_code == 200
            delete_response = client.delete(f"/api/v1/warehouses/{warehouse_response.json()['id']}")
            assert delete_response.status_code == 409
            assert delete_response.json()["error"]["code"] == "WAREHOUSE_IN_USE"
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        transaction.rollback()
        connection.close()


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_inbound_outbound_confirmation_updates_stock_atomically() -> None:
    connection = engine.connect()
    transaction = connection.begin()
    test_sessions = sessionmaker(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    def override_get_db():
        with test_sessions() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    previous_override = app.dependency_overrides.get(get_db)
    previous_user_override = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex
    acting_user = User(
        id=uuid4(),
        name=f"Integration admin {suffix}",
        email=f"admin_{suffix}@example.test",
        role="Quản trị viên",
        active=True,
    )
    with test_sessions() as db:
        db.add(acting_user)
        db.commit()
    app.dependency_overrides[get_current_user] = lambda: acting_user

    try:
        with TestClient(app) as client:
            category_response = client.post("/api/v1/categories", json={"name": f"Test {suffix}"})
            supplier_response = client.post(
                "/api/v1/suppliers",
                json={
                    "code": f"TEST-{suffix}",
                    "name": f"Test supplier {suffix}",
                    "phone": "0900000000",
                    "email": f"test-{suffix}@example.invalid",
                    "address": "Test address",
                    "active": True,
                },
            )
            warehouse_response = client.post(
                "/api/v1/warehouses",
                json={
                    "code": f"TEST-{suffix}",
                    "name": f"Test warehouse {suffix}",
                    "address": "Test address",
                    "manager": "Test manager",
                    "status": "Đang hoạt động",
                },
            )
            assert category_response.status_code == 201
            assert supplier_response.status_code == 201
            assert warehouse_response.status_code == 201
            inactive_supplier_response = client.post(
                "/api/v1/suppliers",
                json={
                    "code": f"INACTIVE-{suffix}",
                    "name": f"Inactive supplier {suffix}",
                    "phone": "",
                    "email": "",
                    "address": "",
                    "active": False,
                },
            )
            assert inactive_supplier_response.status_code == 201
            product_response = client.post(
                "/api/v1/products",
                json={
                    "sku": f"TEST-{suffix}",
                    "barcode": None,
                    "name": f"Test product {suffix}",
                    "category": category_response.json()["name"],
                    "unit": "chiếc",
                    "cost": 100,
                    "minStock": 1,
                    "status": "Đang kinh doanh",
                },
            )
            assert product_response.status_code == 201
            product_id = product_response.json()["id"]
            warehouse_id = warehouse_response.json()["id"]

            def create_document(
                document_type: str,
                quantity: int,
                selected_supplier_id: str | None = None,
                idempotency_key: str | None = None,
            ) -> str:
                headers = {"Idempotency-Key": idempotency_key} if idempotency_key else None
                response = client.post(
                    "/api/v1/documents",
                    headers=headers,
                    json={
                        "type": document_type,
                        "warehouseId": warehouse_id,
                        "supplierId": selected_supplier_id,
                        "partner": "Integration test",
                        "note": "",
                        "lines": [{"productId": product_id, "quantity": quantity, "unitCost": 100}],
                    },
                )
                assert response.status_code in (200, 201)
                return response.json()["id"]

            missing_supplier_response = client.post(
                "/api/v1/documents",
                json={
                    "type": "Nhập kho",
                    "warehouseId": warehouse_id,
                    "partner": "Không được nhận tên tự do",
                    "lines": [{"productId": product_id, "quantity": 1, "unitCost": 100}],
                },
            )
            assert missing_supplier_response.status_code == 422
            invalid_supplier_response = client.post(
                "/api/v1/documents",
                json={
                    "type": "Nhập kho",
                    "warehouseId": warehouse_id,
                    "supplierId": str(uuid4()),
                    "partner": "Không được tin tên từ client",
                    "lines": [{"productId": product_id, "quantity": 1, "unitCost": 100}],
                },
            )
            assert invalid_supplier_response.status_code == 404
            inactive_supplier_request = client.post(
                "/api/v1/documents",
                json={
                    "type": "Nhập kho",
                    "warehouseId": warehouse_id,
                    "supplierId": inactive_supplier_response.json()["id"],
                    "lines": [{"productId": product_id, "quantity": 1, "unitCost": 100}],
                },
            )
            assert inactive_supplier_request.status_code == 400
            assert inactive_supplier_request.json()["error"]["code"] == "SUPPLIER_INACTIVE"

            inbound_key = f"inbound-{suffix}"
            inbound_id = create_document("Nhập kho", 10, supplier_response.json()["id"], inbound_key)
            replayed_inbound_id = create_document("Nhập kho", 10, supplier_response.json()["id"], inbound_key)
            assert replayed_inbound_id == inbound_id
            changed_request_response = client.post(
                "/api/v1/documents",
                headers={"Idempotency-Key": inbound_key},
                json={
                    "type": "Nhập kho",
                    "warehouseId": warehouse_id,
                    "supplierId": supplier_response.json()["id"],
                    "partner": "Integration test",
                    "note": "different payload",
                    "lines": [{"productId": product_id, "quantity": 10, "unitCost": 100}],
                },
            )
            assert changed_request_response.status_code == 409
            assert changed_request_response.json()["error"]["code"] in ("IDEMPOTENCY_KEY_DUPLICATE", "IDEMPOTENCY_KEY_REUSED")
            inbound_document = client.get(f"/api/v1/documents/{inbound_id}").json()
            assert inbound_document["supplierId"] == supplier_response.json()["id"]
            assert inbound_document["partner"] == supplier_response.json()["name"]
            assert client.post(f"/api/v1/documents/{inbound_id}/confirm").status_code == 200

            outbound_id = create_document("Xuất kho", 3)
            assert client.post(f"/api/v1/documents/{outbound_id}/confirm").status_code == 200

            insufficient_outbound_id = create_document("Xuất kho", 8)
            insufficient_response = client.post(f"/api/v1/documents/{insufficient_outbound_id}/confirm")
            assert insufficient_response.status_code == 400
            assert insufficient_response.json()["error"]["code"] == "INSUFFICIENT_STOCK"

            scan_event_id = str(uuid4())
            client_timestamp = datetime.now(timezone.utc).isoformat()
            scanner_document_payload = {
                "type": "Nhập kho",
                "warehouseId": warehouse_id,
                "supplierId": supplier_response.json()["id"],
                "partner": supplier_response.json()["name"],
                "scanPoint": "GATE_A",
                "scanEventId": scan_event_id,
                "clientTimestamp": client_timestamp,
                "lines": [{"productId": product_id, "quantity": 2, "unitCost": 100}],
            }
            scanner_document_response = client.post(
                "/api/v1/documents",
                headers={"Idempotency-Key": str(uuid4())},
                json=scanner_document_payload,
            )
            assert scanner_document_response.status_code == 201
            scanner_replay = client.post(
                "/api/v1/documents",
                headers={"Idempotency-Key": str(uuid4())},
                json=scanner_document_payload,
            )
            assert scanner_replay.status_code == 201
            assert scanner_replay.json()["id"] == scanner_document_response.json()["id"]
            assert scanner_replay.json()["scanPoint"] == "GATE_A"
            conflicting_scan = client.post(
                "/api/v1/documents",
                headers={"Idempotency-Key": str(uuid4())},
                json={**scanner_document_payload, "lines": [{"productId": product_id, "quantity": 3, "unitCost": 100}]},
            )
            assert conflicting_scan.status_code == 409
            assert conflicting_scan.json()["error"]["code"] == "SCAN_EVENT_ALREADY_PROCESSED"

            snapshot = client.get("/api/v1/bootstrap").json()
            inventory = next(row for row in snapshot["inventory"] if row["productId"] == product_id)
            failed_document = next(row for row in snapshot["documents"] if row["id"] == insufficient_outbound_id)
            assert inventory["quantity"] == 7
            assert failed_document["status"] == "Bản nháp"
            assert len([row for row in snapshot["transactions"] if row["productId"] == product_id]) == 2
            rejected_audit = next(
                row for row in snapshot["auditLogs"]
                if row["result"] == "rejected" and row["details"]["errorCode"] == "INSUFFICIENT_STOCK"
            )
            assert rejected_audit["statusCode"] == 400
            duplicate_key_audit = next(
                row for row in snapshot["auditLogs"]
                if row["result"] == "rejected" and row["details"]["errorCode"] in ("IDEMPOTENCY_KEY_DUPLICATE", "IDEMPOTENCY_KEY_REUSED")
            )
            assert duplicate_key_audit["statusCode"] == 409
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        transaction.rollback()
        connection.close()


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_scanner_qr_join_and_scan_delivery_rolls_back_test_data() -> None:
    connection = engine.connect()
    transaction = connection.begin()
    test_sessions = sessionmaker(
        bind=connection,
        autoflush=False,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    def override_get_db():
        with test_sessions() as db:
            yield db

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db

    try:
        with TestClient(app) as client:
            session_response = client.post("/api/v1/scanner/sessions")
            assert session_response.status_code == 201
            session = session_response.json()
            session_id = session["sessionId"]
            owner_headers = {"Authorization": f"Bearer {session['ownerToken']}"}

            qr_response = client.post(f"/api/v1/scanner/sessions/{session_id}/qr", headers=owner_headers)
            assert qr_response.status_code == 200
            join_response = client.post(
                f"/api/v1/scanner/sessions/{session_id}/join",
                json={"qrNonce": qr_response.json()["nonce"], "deviceName": "Integration test device"},
            )
            assert join_response.status_code == 200
            assert join_response.json()["joined"] is True
            replayed_join = client.post(
                f"/api/v1/scanner/sessions/{session_id}/join",
                json={"qrNonce": qr_response.json()["nonce"], "deviceName": "Replay attempt"},
            )
            assert replayed_join.status_code == 409

            event = {
                "eventId": str(uuid4()),
                "sessionId": session_id,
                "barcode": "8938501001001",
                "format": "EAN_13",
                "scannedAt": "2026-01-01T00:00:00Z",
                "deviceId": "integration-test",
            }
            device_headers = {"Authorization": f"Bearer {join_response.json()['deviceToken']}"}
            scan_url = f"/api/v1/scanner/sessions/{session_id}/scans"
            scan_response = client.post(scan_url, json=event, headers=device_headers)
            assert scan_response.status_code == 200
            assert scan_response.json()["delivered"] is True
            assert scan_response.json()["duplicate"] is False
            assert client.get(f"/api/v1/scanner/sessions/{session_id}", headers=owner_headers).json()["status"] == "connected"

            duplicate_response = client.post(scan_url, json=event, headers=device_headers)
            assert duplicate_response.status_code == 200
            assert duplicate_response.json()["duplicate"] is True

            second_event = {**event, "eventId": str(uuid4()), "barcode": "8938501001002"}
            second_scan_response = client.post(scan_url, json=second_event, headers=device_headers)
            assert second_scan_response.status_code == 200
            assert second_scan_response.json()["delivered"] is True
            assert second_scan_response.json()["duplicate"] is False
            stored_events = client.get(scan_url, headers=owner_headers).json()
            assert len(stored_events) == 2
            assert {item["eventId"] for item in stored_events} == {event["eventId"], second_event["eventId"]}
            assert {item["barcode"] for item in stored_events} == {event["barcode"], second_event["barcode"]}
            assert stored_events[0]["scannedAt"].startswith("2026-01-01T00:00:00") or "2026-01-01" in stored_events[0]["scannedAt"]
            leave_response = client.post(
                f"/api/v1/scanner/sessions/{session_id}/leave",
                headers=device_headers,
            )
            assert leave_response.status_code == 200
            assert leave_response.json()["status"] == "ended"
            assert client.post(scan_url, json=event, headers=device_headers).status_code == 410
            assert client.post(f"/api/v1/scanner/sessions/{session_id}/close", headers=owner_headers).status_code == 200
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        transaction.rollback()
        connection.close()


@pytest.mark.skipif(
    os.getenv("RUN_POSTGRES_INTEGRATION_TESTS") != "1",
    reason="Set RUN_POSTGRES_INTEGRATION_TESTS=1 to run against PostgreSQL.",
)
def test_idempotency_user_isolation_and_concurrency() -> None:
    previous_user_override = app.dependency_overrides.get(get_current_user)
    suffix = uuid4().hex
    user_a_id = uuid4()
    user_b_id = uuid4()
    created_document_ids: list[UUID] = []
    wh_id: str | None = None
    sup_id: str | None = None
    prod_id: str | None = None

    def make_user(uid: UUID, name: str, role: str) -> User:
        return User(
            id=uid,
            name=name,
            email=f"{name.lower().replace(' ', '')}@example.test",
            role=role,
            active=True,
        )

    user_a_obj = make_user(user_a_id, f"User A {suffix}", "Quản trị viên")
    user_b_obj = make_user(user_b_id, f"User B {suffix}", "Quản lý kho")

    with Session(engine) as db:
        db.add_all([user_a_obj, user_b_obj])
        db.commit()

    from fastapi import Request
    def dynamic_current_user(request: Request) -> User:
        user_header = request.headers.get("X-Acting-User")
        if user_header == "user_b":
            return make_user(user_b_id, f"User B {suffix}", "Quản lý kho")
        return make_user(user_a_id, f"User A {suffix}", "Quản trị viên")

    app.dependency_overrides[get_current_user] = dynamic_current_user

    try:
        with TestClient(app) as client:
            cat_res = client.post("/api/v1/categories", headers={"X-Acting-User": "user_a"}, json={"name": f"Idemp Cat {suffix}"})
            assert cat_res.status_code == 201

            wh_res = client.post(
                "/api/v1/warehouses",
                headers={"X-Acting-User": "user_a"},
                json={
                    "code": f"WH-{suffix}",
                    "name": f"Warehouse {suffix}",
                    "address": "123 Test St",
                    "manager": "Tester",
                    "status": "Đang hoạt động",
                },
            )
            assert wh_res.status_code == 201
            wh_id = wh_res.json()["id"]

            sup_res = client.post(
                "/api/v1/suppliers",
                headers={"X-Acting-User": "user_a"},
                json={
                    "code": f"SUP-{suffix}",
                    "name": f"Supplier {suffix}",
                    "phone": "0912345678",
                    "email": f"sup_{suffix}@example.test",
                    "address": "Supplier Addr",
                    "active": True,
                },
            )
            assert sup_res.status_code == 201
            sup_id = sup_res.json()["id"]

            prod_res = client.post(
                "/api/v1/products",
                headers={"X-Acting-User": "user_a"},
                json={
                    "sku": f"IDP-{suffix}",
                    "barcode": None,
                    "name": f"Idemp Product {suffix}",
                    "category": f"Idemp Cat {suffix}",
                    "unit": "hộp",
                    "cost": 50000,
                    "minStock": 5,
                    "status": "Đang kinh doanh",
                },
            )
            assert prod_res.status_code == 201
            prod_id = prod_res.json()["id"]

            key_k = f"key-k-{suffix}"
            payload_p = {
                "type": "Nhập kho",
                "warehouseId": wh_id,
                "supplierId": sup_id,
                "partner": f"Supplier {suffix}",
                "note": "Payload P",
                "lines": [{"productId": prod_id, "quantity": 10, "unitCost": 50000}],
            }
            payload_q = {
                "type": "Nhập kho",
                "warehouseId": wh_id,
                "supplierId": sup_id,
                "partner": f"Supplier {suffix}",
                "note": "Payload Q (different content)",
                "lines": [{"productId": prod_id, "quantity": 25, "unitCost": 50000}],
            }

            # 1. User A gửi key K với payload P → tạo một phiếu
            resp_a1 = client.post("/api/v1/documents", headers={"Idempotency-Key": key_k, "X-Acting-User": "user_a"}, json=payload_p)
            assert resp_a1.status_code == 201
            doc_a_id = resp_a1.json()["id"]
            doc_a_code = resp_a1.json()["code"]
            created_document_ids.append(UUID(doc_a_id))

            # 2. User A gửi lại key K với payload P → nhận lại phiếu cũ
            resp_a2 = client.post("/api/v1/documents", headers={"Idempotency-Key": key_k, "X-Acting-User": "user_a"}, json=payload_p)
            assert resp_a2.status_code == 200
            assert resp_a2.json()["id"] == doc_a_id
            assert resp_a2.json()["code"] == doc_a_code

            # 3. User A gửi key K với payload Q → nhận HTTP 409
            resp_a3 = client.post("/api/v1/documents", headers={"Idempotency-Key": key_k, "X-Acting-User": "user_a"}, json=payload_q)
            assert resp_a3.status_code == 409
            assert resp_a3.json()["error"]["code"] == "IDEMPOTENCY_KEY_DUPLICATE"

            # 4. User B gửi key K với payload Q → được tạo phiếu riêng
            resp_b1 = client.post("/api/v1/documents", headers={"Idempotency-Key": key_k, "X-Acting-User": "user_b"}, json=payload_q)
            assert resp_b1.status_code == 201
            doc_b_id = resp_b1.json()["id"]
            doc_b_code = resp_b1.json()["code"]
            assert doc_b_id != doc_a_id
            assert doc_b_code != doc_a_code
            created_document_ids.append(UUID(doc_b_id))

            # 5. User B gửi lại key K → chỉ nhận phiếu của User B
            resp_b2 = client.post("/api/v1/documents", headers={"Idempotency-Key": key_k, "X-Acting-User": "user_b"}, json=payload_q)
            assert resp_b2.status_code == 200
            assert resp_b2.json()["id"] == doc_b_id
            assert resp_b2.json()["id"] != doc_a_id

            # Kiểm tra số lượng phiếu thực tế trong database sau 5 bước trên
            with Session(engine) as db:
                from app.models import StockDocument
                docs_a = db.scalars(select(StockDocument).where(StockDocument.created_by_user_id == user_a_id)).all()
                docs_b = db.scalars(select(StockDocument).where(StockDocument.created_by_user_id == user_b_id)).all()
                assert len(docs_a) == 1
                assert len(docs_b) == 1
                assert docs_a[0].id == UUID(doc_a_id)
                assert docs_b[0].id == UUID(doc_b_id)

            # 6. Hai user đồng thời gửi cùng một key → không xung đột dữ liệu
            key_concurrent = f"key-conc-{suffix}"
            payload_conc_a = {**payload_p, "note": "Concurrent user A"}
            payload_conc_b = {**payload_q, "note": "Concurrent user B"}

            def send_conc_a():
                with TestClient(app) as local_client:
                    return local_client.post(
                        "/api/v1/documents",
                        headers={"Idempotency-Key": key_concurrent, "X-Acting-User": "user_a"},
                        json=payload_conc_a,
                    )

            def send_conc_b():
                with TestClient(app) as local_client:
                    return local_client.post(
                        "/api/v1/documents",
                        headers={"Idempotency-Key": key_concurrent, "X-Acting-User": "user_b"},
                        json=payload_conc_b,
                    )

            with ThreadPoolExecutor(max_workers=2) as executor:
                f_a = executor.submit(send_conc_a)
                f_b = executor.submit(send_conc_b)
                r_a = f_a.result()
                r_b = f_b.result()

            assert r_a.status_code == 201
            assert r_b.status_code == 201
            assert r_a.json()["id"] != r_b.json()["id"]
            for r in (r_a, r_b):
                if r.status_code in (200, 201) and "id" in r.json():
                    created_document_ids.append(UUID(r.json()["id"]))

            # 7. Hai request cùng user đồng thời gửi cùng key → không tạo hai phiếu
            key_same_user = f"key-same-{suffix}"
            payload_same = {**payload_p, "note": "Same user concurrent"}

            def send_same():
                with TestClient(app) as local_client:
                    return local_client.post(
                        "/api/v1/documents",
                        headers={"Idempotency-Key": key_same_user, "X-Acting-User": "user_a"},
                        json=payload_same,
                    )

            with ThreadPoolExecutor(max_workers=2) as executor:
                f1 = executor.submit(send_same)
                f2 = executor.submit(send_same)
                r1 = f1.result()
                r2 = f2.result()

            assert {r1.status_code, r2.status_code}.issubset({200, 201})
            assert r1.json()["id"] == r2.json()["id"]
            for r in (r1, r2):
                if r.status_code in (200, 201) and "id" in r.json():
                    created_document_ids.append(UUID(r.json()["id"]))

            # Kiểm tra database: chỉ đúng 1 phiếu được tạo với key_same_user
            with Session(engine) as db:
                same_user_docs = db.scalars(
                    select(StockDocument).where(
                        StockDocument.created_by_user_id == user_a_id,
                        StockDocument.note == "Same user concurrent",
                    )
                ).all()
                assert len(same_user_docs) == 1

            # 8. Không làm hỏng chức năng chống trùng theo scanEventId
            scan_id = uuid4()
            scan_payload = {
                "type": "Nhập kho",
                "warehouseId": wh_id,
                "supplierId": sup_id,
                "partner": f"Supplier {suffix}",
                "scanPoint": "GATE_A",
                "scanEventId": str(scan_id),
                "clientTimestamp": datetime.now(timezone.utc).isoformat(),
                "lines": [{"productId": prod_id, "quantity": 5, "unitCost": 50000}],
            }
            scan_res1 = client.post("/api/v1/documents", headers={"X-Acting-User": "user_a"}, json=scan_payload)
            assert scan_res1.status_code == 201
            scan_doc_id = scan_res1.json()["id"]
            created_document_ids.append(UUID(scan_doc_id))

            scan_res2 = client.post("/api/v1/documents", headers={"X-Acting-User": "user_a"}, json=scan_payload)
            assert scan_res2.status_code == 201
            assert scan_res2.json()["id"] == scan_doc_id

            scan_conflict = client.post(
                "/api/v1/documents",
                headers={"X-Acting-User": "user_a"},
                json={**scan_payload, "lines": [{"productId": prod_id, "quantity": 99, "unitCost": 50000}]},
            )
            assert scan_conflict.status_code == 409
            assert scan_conflict.json()["error"]["code"] == "SCAN_EVENT_ALREADY_PROCESSED"
    finally:
        if previous_user_override is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous_user_override
        with Session(engine) as db:
            if created_document_ids:
                unique_doc_ids = list(dict.fromkeys(created_document_ids))
                db.execute(
                    text("DELETE FROM stock_document_items WHERE document_id = ANY(:doc_ids)"),
                    {"doc_ids": unique_doc_ids},
                )
                db.execute(
                    text("DELETE FROM stock_documents WHERE id = ANY(:doc_ids)"),
                    {"doc_ids": unique_doc_ids},
                )
            db.execute(text("DELETE FROM idempotency_requests WHERE user_id IN (:u1, :u2)"), {"u1": user_a_id, "u2": user_b_id})
            if prod_id:
                db.execute(text("DELETE FROM products WHERE id = :pid"), {"pid": UUID(prod_id)})
            if sup_id:
                db.execute(text("DELETE FROM suppliers WHERE id = :sid"), {"sid": UUID(sup_id)})
            if wh_id:
                db.execute(text("DELETE FROM warehouses WHERE id = :wid"), {"wid": UUID(wh_id)})
            db.execute(text("DELETE FROM categories WHERE name = :cat_name"), {"cat_name": f"Idemp Cat {suffix}"})
            db.execute(text("DELETE FROM users WHERE id IN (:u1, :u2)"), {"u1": user_a_id, "u2": user_b_id})
            db.commit()
