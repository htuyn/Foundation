from datetime import datetime, timezone
import hashlib
import json
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload

from app.core.errors import ApiError
from app.db.session import get_db
from app.models import AuditLog, IdempotencyRequest, Inventory, Product, StockDocument, StockDocumentItem, StockMovement, Supplier, Warehouse
from app.schemas import DocumentInput
from app.services.audit_context import current_actor_name
from app.services.serialization import document_dict

router = APIRouter()


def get_document(db: Session, document_id: UUID, lock: bool = False) -> StockDocument:
    query = select(StockDocument).options(selectinload(StockDocument.items), selectinload(StockDocument.supplier)).where(StockDocument.id == document_id)
    if lock:
        query = query.with_for_update()
    document = db.scalar(query)
    if not document:
        raise ApiError(404, "DOCUMENT_NOT_FOUND", "Không tìm thấy phiếu.")
    return document


@router.get("/documents")
def list_documents(
    type: str | None = None,
    status: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = select(StockDocument).options(selectinload(StockDocument.items), selectinload(StockDocument.supplier))
    if type:
        query = query.where(StockDocument.type == type)
    if status:
        query = query.where(StockDocument.status == status)
    if q:
        query = query.where(StockDocument.code.ilike(f"%{q.strip()}%") | StockDocument.partner.ilike(f"%{q.strip()}%"))
    documents = db.scalars(
        query.order_by(StockDocument.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize)
    ).all()
    return [document_dict(item) for item in documents]


@router.post("/documents", status_code=201)
def create_document(
    payload: DocumentInput,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: Session = Depends(get_db),
):
    if idempotency_key is not None:
        idempotency_key = idempotency_key.strip()
        if not idempotency_key or len(idempotency_key) > 255:
            raise ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key phải có từ 1 đến 255 ký tự.")
    request_json = json.dumps(payload.model_dump(mode="json", by_alias=True), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    request_hash = hashlib.sha256(request_json.encode("utf-8")).hexdigest()
    with db.begin():
        if idempotency_key:
            db.execute(
                pg_insert(IdempotencyRequest)
                .values(
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    response_status=201,
                    response_json=None,
                )
                .on_conflict_do_nothing(index_elements=[IdempotencyRequest.idempotency_key])
            )
            prior_request = db.get(IdempotencyRequest, idempotency_key)
            if prior_request.request_hash != request_hash:
                raise ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key đã được dùng cho nội dung yêu cầu khác.")
            if prior_request.response_json is not None:
                db.add(
                    AuditLog(
                        message=f"Gửi lại yêu cầu tạo phiếu {prior_request.response_json.get('code', '')}",
                        actor_name=current_actor_name(db),
                        action="POST /api/v1/documents",
                        outcome="replayed",
                        status_code=prior_request.response_status,
                        details={"documentId": prior_request.response_json.get("id")},
                    )
                )
                return prior_request.response_json

        warehouse = db.get(Warehouse, payload.warehouseId)
        if not warehouse:
            raise ApiError(404, "WAREHOUSE_NOT_FOUND", "Không tìm thấy kho.")
        supplier = None
        partner = payload.partner
        if payload.type == "Nhập kho":
            supplier = db.scalar(select(Supplier).where(Supplier.id == payload.supplierId).with_for_update())
            if not supplier:
                raise ApiError(404, "SUPPLIER_NOT_FOUND", "Không tìm thấy nhà cung cấp đã chọn.")
            if not supplier.active:
                raise ApiError(400, "SUPPLIER_INACTIVE", "Nhà cung cấp đang tạm ngưng, không thể tạo phiếu nhập.")
            partner = supplier.name
        product_ids = [line.productId for line in payload.lines]
        products = set(db.scalars(select(Product.id).where(Product.id.in_(product_ids))).all())
        missing = [str(product_id) for product_id in product_ids if product_id not in products]
        if missing:
            raise ApiError(422, "PRODUCT_NOT_FOUND", "Một hoặc nhiều sản phẩm không tồn tại.", {"productIds": missing})

        now = datetime.now(timezone.utc)
        year = now.year
        prefix = "PN" if payload.type == "Nhập kho" else "PX"
        stem = f"{prefix}-{year}-"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key)::bigint)"), {"key": f"warehouse-document-{stem}"})
        codes = db.scalars(select(StockDocument.code).where(StockDocument.code.like(f"{stem}%"))).all()
        numbers = [int(code.rsplit("-", 1)[-1]) for code in codes if code.rsplit("-", 1)[-1].isdigit()]
        code = f"{stem}{max(numbers, default=0) + 1:04d}"
        document = StockDocument(
            code=code,
            type=payload.type,
            warehouse_id=payload.warehouseId,
            supplier_id=supplier.id if supplier else None,
            supplier=supplier,
            partner=partner,
            status="Bản nháp",
            note=payload.note,
            items=[
                StockDocumentItem(product_id=line.productId, quantity=line.quantity, unit_cost=line.unitCost)
                for line in payload.lines
            ],
        )
        db.add(document)
        db.flush()
        db.add(
            AuditLog(
                message=f"Tạo phiếu {document.code}",
                actor_name=current_actor_name(db),
                action="POST /api/v1/documents",
                outcome="success",
                status_code=201,
                details={"documentId": str(document.id), "documentCode": document.code},
            )
        )
        db.flush()
        result = document_dict(document)
        if idempotency_key:
            prior_request.response_json = result
    return result


@router.get("/documents/{document_id}")
def read_document(document_id: UUID, db: Session = Depends(get_db)):
    return document_dict(get_document(db, document_id))


@router.post("/documents/{document_id}/confirm")
def confirm_document(document_id: UUID, db: Session = Depends(get_db)):
    with db.begin():
        document = get_document(db, document_id, lock=True)
        if document.status == "Đã xác nhận":
            return document_dict(document)
        if document.status != "Bản nháp":
            raise ApiError(400, "DOCUMENT_NOT_DRAFT", "Chỉ có thể xác nhận phiếu nháp.")
        if not document.items:
            raise ApiError(422, "EMPTY_DOCUMENT", "Phiếu cần có ít nhất một sản phẩm.")

        for item in sorted(document.items, key=lambda line: str(line.product_id)):
            delta = item.quantity if document.type == "Nhập kho" else -item.quantity
            if delta > 0:
                statement = pg_insert(Inventory).values(
                    product_id=item.product_id,
                    warehouse_id=document.warehouse_id,
                    quantity=delta,
                    location="Khu mới",
                )
                statement = statement.on_conflict_do_update(
                    index_elements=[Inventory.product_id, Inventory.warehouse_id],
                    set_={"quantity": Inventory.quantity + statement.excluded.quantity},
                )
                db.execute(statement)
            else:
                result = db.execute(
                    Inventory.__table__.update()
                    .where(
                        Inventory.product_id == item.product_id,
                        Inventory.warehouse_id == document.warehouse_id,
                        Inventory.quantity >= item.quantity,
                    )
                    .values(quantity=Inventory.quantity - item.quantity)
                )
                if result.rowcount != 1:
                    product = db.get(Product, item.product_id)
                    available = db.scalar(
                        select(Inventory.quantity).where(
                            Inventory.product_id == item.product_id,
                            Inventory.warehouse_id == document.warehouse_id,
                        )
                    ) or 0
                    raise ApiError(
                        400,
                        "INSUFFICIENT_STOCK",
                        f"{product.name if product else 'Sản phẩm'}: tồn kho không đủ (còn {available}, cần {item.quantity}).",
                    )

            db.add(
                StockMovement(
                    code=document.code,
                    movement_type=document.type,
                    product_id=item.product_id,
                    warehouse_id=document.warehouse_id,
                    document_id=document.id,
                    quantity_delta=delta,
                    actor_name=current_actor_name(db),
                    source=document.partner or document.code,
                )
            )
        document.status = "Đã xác nhận"
        db.add(
            AuditLog(
                message=f"Xác nhận phiếu {document.code}",
                actor_name=current_actor_name(db),
                action=f"Xác nhận phiếu {document.code}",
                outcome="success",
            )
        )
        db.flush()
        result = document_dict(document)
    return result


@router.post("/documents/{document_id}/cancel")
def cancel_document(document_id: UUID, db: Session = Depends(get_db)):
    with db.begin():
        document = get_document(db, document_id, lock=True)
        if document.status != "Bản nháp":
            raise ApiError(400, "DOCUMENT_NOT_DRAFT", "Chỉ có thể hủy phiếu nháp.")
        document.status = "Đã hủy"
        db.add(
            AuditLog(
                message=f"Hủy phiếu {document.code}",
                actor_name=current_actor_name(db),
                action=f"Hủy phiếu {document.code}",
                outcome="success",
            )
        )
        result = document_dict(document)
    return result
