from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.main import app
from app.models import AuditLog, IdempotencyRequest, ScanEvent, StockDocument
from app.services.audit_context import current_actor_name, set_actor_name
from app.schemas import DocumentInput, DocumentLineInput, InventoryAdjustmentInput, ProductInput, ScannerEventInput


def test_health_endpoint_does_not_require_database() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "smart-warehouse-api"}


def test_health_readiness_reports_database_unavailable() -> None:
    response = TestClient(app).get("/health/ready")

    assert response.status_code in (200, 503)
    if response.status_code == 503:
        assert response.json()["error"]["code"] == "DATABASE_UNAVAILABLE"


def test_product_input_keeps_frontend_field_names_and_values() -> None:
    payload = ProductInput(
        sku=" SKU-1 ", barcode="   ", name=" Sản phẩm ", category=" Đồ khô ", cost="10.50", minStock=2
    )

    assert payload.sku == "SKU-1"
    assert payload.barcode is None
    assert payload.category == "Đồ khô"
    assert payload.minStock == 2
    assert payload.cost == 10.5


def test_document_rejects_duplicate_products_and_invalid_quantities() -> None:
    product_id = uuid4()
    line = DocumentLineInput(productId=product_id, quantity=1, unitCost=0)

    with pytest.raises(ValidationError):
        DocumentInput(
            type="Nhập kho", warehouseId=uuid4(), supplierId=uuid4(), partner="Nhà cung cấp", lines=[line, line]
        )
    with pytest.raises(ValidationError):
        DocumentLineInput(productId=product_id, quantity=0, unitCost=0)


def test_inbound_document_requires_supplier_and_outbound_keeps_partner() -> None:
    line = DocumentLineInput(productId=uuid4(), quantity=1, unitCost=0)
    with pytest.raises(ValidationError):
        DocumentInput(type="Nhập kho", warehouseId=uuid4(), lines=[line])

    outbound = DocumentInput(type="Xuất kho", warehouseId=uuid4(), partner="Đơn SO-1", lines=[line])
    assert outbound.supplierId is None
    assert outbound.partner == "Đơn SO-1"


def test_adjustment_rejects_zero_and_scanner_requires_timezone_aware_timestamp() -> None:
    with pytest.raises(ValidationError):
        InventoryAdjustmentInput(productId=uuid4(), warehouseId=uuid4(), quantity=0, reason="Kiểm kê")

    payload = ScannerEventInput(
        eventId=uuid4(), sessionId=uuid4(), barcode="8930000000000", format="EAN_13",
        scannedAt=datetime.now(timezone.utc),
    )
    assert payload.scannedAt.tzinfo is not None
    code39_payload = ScannerEventInput(
        eventId=uuid4(), sessionId=uuid4(), barcode="SKU-39", format="CODE_39",
        scannedAt=datetime.now(timezone.utc),
    )
    assert code39_payload.format == "CODE_39"
    scanner_format_constraint = next(item for item in ScanEvent.__table__.constraints if item.name == "ck_scan_events_format")
    assert "CODE_39" in str(scanner_format_constraint.sqltext)

    with pytest.raises(ValidationError):
        ScannerEventInput(
            eventId=uuid4(), sessionId=uuid4(), barcode="8930000000000", format="EAN_13",
            scannedAt=datetime(2026, 10, 10, 12, 0, 0),
        )


def test_pagination_limits_are_published_in_openapi() -> None:
    schema = app.openapi()
    assert "/api/v1/products" in schema["paths"]
    assert "/api/v1/documents/{document_id}/confirm" in schema["paths"]
    assert "/api/v1/scanner/sessions/{session_id}/scans" in schema["paths"]
    assert "/api/v1/scanner/sessions/{session_id}/leave" in schema["paths"]
    lookup_parameters = {parameter["name"] for parameter in schema["paths"]["/api/v1/products/lookup"]["get"]["parameters"]}
    assert {"code", "barcode"}.issubset(lookup_parameters)


def test_document_idempotency_and_audit_schema_constraints() -> None:
    assert IdempotencyRequest.__table__.primary_key.columns.keys() == ["idempotency_key"]
    assert StockDocument.__table__.c.code.unique is True
    assert {"action", "outcome", "status_code", "details"}.issubset(AuditLog.__table__.c.keys())


def test_audit_actor_context_uses_authenticated_request_identity() -> None:
    db = Session()
    set_actor_name(db, "Nhân viên kho")
    assert current_actor_name(db) == "Nhân viên kho"
    assert current_actor_name(Session()) == "Hệ thống"
    db.close()
