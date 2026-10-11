import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.api.deps import get_db
from app.db.session import engine
from app.main import app


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
            yield db

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex

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
            yield db

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex

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
            yield db

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex

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
            yield db

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex

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
            yield db

    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    suffix = uuid4().hex

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

            def create_document(document_type: str, quantity: int, selected_supplier_id: str | None = None) -> str:
                response = client.post(
                    "/api/v1/documents",
                    json={
                        "type": document_type,
                        "warehouseId": warehouse_id,
                        "supplierId": selected_supplier_id,
                        "partner": "Integration test",
                        "note": "",
                        "lines": [{"productId": product_id, "quantity": quantity, "unitCost": 100}],
                    },
                )
                assert response.status_code == 201
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
            assert inactive_supplier_request.status_code == 409
            assert inactive_supplier_request.json()["error"]["code"] == "SUPPLIER_INACTIVE"

            inbound_id = create_document("Nhập kho", 10, supplier_response.json()["id"])
            inbound_document = client.get(f"/api/v1/documents/{inbound_id}").json()
            assert inbound_document["supplierId"] == supplier_response.json()["id"]
            assert inbound_document["partner"] == supplier_response.json()["name"]
            assert client.post(f"/api/v1/documents/{inbound_id}/confirm").status_code == 200

            outbound_id = create_document("Xuất kho", 3)
            assert client.post(f"/api/v1/documents/{outbound_id}/confirm").status_code == 200

            insufficient_outbound_id = create_document("Xuất kho", 8)
            insufficient_response = client.post(f"/api/v1/documents/{insufficient_outbound_id}/confirm")
            assert insufficient_response.status_code == 409
            assert insufficient_response.json()["error"]["code"] == "INSUFFICIENT_STOCK"

            snapshot = client.get("/api/v1/bootstrap").json()
            inventory = next(row for row in snapshot["inventory"] if row["productId"] == product_id)
            failed_document = next(row for row in snapshot["documents"] if row["id"] == insufficient_outbound_id)
            assert inventory["quantity"] == 7
            assert failed_document["status"] == "Bản nháp"
            assert len([row for row in snapshot["transactions"] if row["productId"] == product_id]) == 2
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
            assert stored_events[0]["scannedAt"].startswith("2026-01-01T00:00:00")
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
