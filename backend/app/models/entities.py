import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    products: Mapped[list["Product"]] = relationship(back_populates="category")
    __table_args__ = (Index("uq_categories_name_lower", func.lower(name), unique=True),)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    sku: Mapped[str] = mapped_column(Text, nullable=False)
    barcode: Mapped[str | None] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False)
    unit: Mapped[str] = mapped_column(Text, nullable=False, default="chiếc")
    cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=Decimal("0"))
    min_stock: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="Đang kinh doanh")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    category: Mapped[Category] = relationship(back_populates="products")
    __table_args__ = (
        CheckConstraint("cost >= 0", name="ck_products_cost_nonnegative"),
        CheckConstraint("min_stock >= 0", name="ck_products_min_stock_nonnegative"),
        CheckConstraint("status IN ('Đang kinh doanh', 'Ngừng kinh doanh')", name="ck_products_status"),
        Index("uq_products_sku_lower", func.lower(func.btrim(sku)), unique=True),
        Index("uq_products_barcode", func.btrim(barcode), unique=True, postgresql_where=text("barcode IS NOT NULL AND btrim(barcode) <> ''")),
        Index("ix_products_category_id", "category_id"),
    )


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    manager_name: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="Đang hoạt động")
    __table_args__ = (
        CheckConstraint("status IN ('Đang hoạt động', 'Tạm ngưng')", name="ck_warehouses_status"),
        Index("uq_warehouses_code_lower", func.lower(code), unique=True),
    )


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    phone: Mapped[str] = mapped_column(Text, nullable=False, default="")
    email: Mapped[str] = mapped_column(Text, nullable=False, default="")
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    __table_args__ = (Index("uq_suppliers_code_lower", func.lower(code), unique=True),)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("role IN ('Quản trị viên', 'Quản lý kho', 'Nhân viên kho', 'Chỉ xem')", name="ck_users_role"),
        Index("uq_users_email_lower", func.lower(email), unique=True),
    )


class Inventory(Base):
    __tablename__ = "inventory"

    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), primary_key=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    location: Mapped[str] = mapped_column(Text, nullable=False, default="Khu mới")
    __table_args__ = (CheckConstraint("quantity >= 0", name="ck_inventory_quantity_nonnegative"),)


class StockDocument(Base):
    __tablename__ = "stock_documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("suppliers.id", ondelete="RESTRICT"))
    partner: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    status: Mapped[str] = mapped_column(Text, nullable=False, default="Bản nháp")
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    items: Mapped[list["StockDocumentItem"]] = relationship(back_populates="document", cascade="all, delete-orphan", order_by="StockDocumentItem.product_id")
    supplier: Mapped[Supplier | None] = relationship()
    __table_args__ = (
        CheckConstraint("type IN ('Nhập kho', 'Xuất kho')", name="ck_stock_documents_type"),
        CheckConstraint("status IN ('Bản nháp', 'Đã xác nhận', 'Đã hủy')", name="ck_stock_documents_status"),
        Index("ix_stock_documents_type_status_created", "type", "status", "created_at"),
        Index("ix_stock_documents_supplier_id", "supplier_id"),
    )


class StockDocumentItem(Base):
    __tablename__ = "stock_document_items"

    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_documents.id", ondelete="RESTRICT"), primary_key=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    document: Mapped[StockDocument] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_stock_document_items_quantity_positive"),
        CheckConstraint("unit_cost >= 0", name="ck_stock_document_items_cost_nonnegative"),
    )


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    movement_type: Mapped[str] = mapped_column(Text, nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stock_documents.id", ondelete="RESTRICT"))
    quantity_delta: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_name: Mapped[str] = mapped_column(Text, nullable=False, default="Hệ thống")
    source: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    __table_args__ = (
        CheckConstraint("movement_type IN ('Nhập kho', 'Xuất kho', 'Điều chỉnh')", name="ck_stock_movements_type"),
        CheckConstraint("quantity_delta <> 0", name="ck_stock_movements_delta_nonzero"),
        ForeignKeyConstraint(
            ["document_id", "product_id"],
            ["stock_document_items.document_id", "stock_document_items.product_id"],
            name="fk_stock_movements_document_line",
            use_alter=True,
        ),
        Index("ix_stock_movements_created_at", "created_at"),
        Index("ix_stock_movements_product_warehouse", "product_id", "warehouse_id"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    actor_name: Mapped[str] = mapped_column(Text, nullable=False, default="Hệ thống")
    __table_args__ = (Index("ix_audit_logs_created_at", "created_at"),)


class ScannerSession(Base):
    __tablename__ = "scanner_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    mode: Mapped[str] = mapped_column(Text, nullable=False, default="api")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="waiting_for_device")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    device_name: Mapped[str | None] = mapped_column(Text)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    owner_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    device_token_hash: Mapped[str | None] = mapped_column(String(64))
    __table_args__ = (CheckConstraint("status IN ('waiting_for_device', 'connected', 'expired', 'ended')", name="ck_scanner_sessions_status"),)


class ScannerQrTicket(Base):
    __tablename__ = "scanner_qr_tickets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scanner_sessions.id", ondelete="CASCADE"), nullable=False)
    nonce_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (Index("ix_scanner_qr_tickets_session_expiry", "session_id", "expires_at"),)


class ScanEvent(Base):
    __tablename__ = "scan_events"

    event_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scanner_sessions.id", ondelete="CASCADE"), nullable=False)
    barcode: Mapped[str] = mapped_column(Text, nullable=False)
    format: Mapped[str] = mapped_column(Text, nullable=False)
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    device_id: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint("format IN ('EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'QR_CODE', 'MANUAL')", name="ck_scan_events_format"),
        Index("ix_scan_events_session_scanned", "session_id", "scanned_at"),
    )
