"""Initial PostgreSQL schema aligned to frontend domain entities.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_categories_name_lower", "categories", [sa.text("lower(name)")], unique=True)

    op.create_table(
        "warehouses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("manager_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.CheckConstraint("status IN ('Đang hoạt động', 'Tạm ngưng')", name="ck_warehouses_status"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_warehouses_code_lower", "warehouses", [sa.text("lower(code)")], unique=True)

    op.create_table(
        "suppliers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("phone", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_suppliers_code_lower", "suppliers", [sa.text("lower(code)")], unique=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("role IN ('Quản trị viên', 'Quản lý kho', 'Nhân viên kho')", name="ck_users_role"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True)

    op.create_table(
        "scanner_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_name", sa.Text(), nullable=True),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("owner_token_hash", sa.String(length=64), nullable=False),
        sa.Column("device_token_hash", sa.String(length=64), nullable=True),
        sa.CheckConstraint("status IN ('waiting_for_device', 'connected', 'expired', 'ended')", name="ck_scanner_sessions_status"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sku", sa.Text(), nullable=False),
        sa.Column("barcode", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("unit", sa.Text(), nullable=False),
        sa.Column("cost", sa.Numeric(14, 2), nullable=False),
        sa.Column("min_stock", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("cost >= 0", name="ck_products_cost_nonnegative"),
        sa.CheckConstraint("min_stock >= 0", name="ck_products_min_stock_nonnegative"),
        sa.CheckConstraint("status IN ('Đang kinh doanh', 'Ngừng kinh doanh')", name="ck_products_status"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_products_sku_lower", "products", [sa.text("lower(sku)")], unique=True)
    op.create_index("uq_products_barcode", "products", ["barcode"], unique=True, postgresql_where=sa.text("barcode IS NOT NULL AND barcode <> ''"))
    op.create_index("ix_products_category_id", "products", ["category_id"])

    op.create_table(
        "stock_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("partner", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.CheckConstraint("type IN ('Nhập kho', 'Xuất kho')", name="ck_stock_documents_type"),
        sa.CheckConstraint("status IN ('Bản nháp', 'Đã xác nhận', 'Đã hủy')", name="ck_stock_documents_status"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_stock_documents_type_status_created", "stock_documents", ["type", "status", "created_at"])

    op.create_table(
        "inventory",
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("location", sa.Text(), nullable=False),
        sa.CheckConstraint("quantity >= 0", name="ck_inventory_quantity_nonnegative"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("product_id", "warehouse_id"),
    )

    op.create_table(
        "stock_document_items",
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_cost", sa.Numeric(14, 2), nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_stock_document_items_quantity_positive"),
        sa.CheckConstraint("unit_cost >= 0", name="ck_stock_document_items_cost_nonnegative"),
        sa.ForeignKeyConstraint(["document_id"], ["stock_documents.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("document_id", "product_id"),
    )

    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("movement_type", sa.Text(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=False),
        sa.Column("warehouse_id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("quantity_delta", sa.Integer(), nullable=False),
        sa.Column("actor_name", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("movement_type IN ('Nhập kho', 'Xuất kho', 'Điều chỉnh')", name="ck_stock_movements_type"),
        sa.CheckConstraint("quantity_delta <> 0", name="ck_stock_movements_delta_nonzero"),
        sa.ForeignKeyConstraint(["document_id"], ["stock_documents.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_foreign_key(
        "fk_stock_movements_document_line",
        "stock_movements",
        "stock_document_items",
        ["document_id", "product_id"],
        ["document_id", "product_id"],
    )
    op.create_index("ix_stock_movements_created_at", "stock_movements", ["created_at"])
    op.create_index("ix_stock_movements_product_warehouse", "stock_movements", ["product_id", "warehouse_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("actor_name", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    op.create_table(
        "scanner_qr_tickets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("nonce_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["scanner_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("nonce_hash"),
    )
    op.create_index("ix_scanner_qr_tickets_session_expiry", "scanner_qr_tickets", ["session_id", "expires_at"])

    op.create_table(
        "scan_events",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("barcode", sa.Text(), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_id", sa.Text(), nullable=True),
        sa.CheckConstraint("format IN ('EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'QR_CODE', 'MANUAL')", name="ck_scan_events_format"),
        sa.ForeignKeyConstraint(["session_id"], ["scanner_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.create_index("ix_scan_events_session_scanned", "scan_events", ["session_id", "scanned_at"])


def downgrade() -> None:
    op.drop_index("ix_scan_events_session_scanned", table_name="scan_events")
    op.drop_table("scan_events")
    op.drop_index("ix_scanner_qr_tickets_session_expiry", table_name="scanner_qr_tickets")
    op.drop_table("scanner_qr_tickets")
    op.drop_index("ix_audit_logs_created_at", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_stock_movements_product_warehouse", table_name="stock_movements")
    op.drop_index("ix_stock_movements_created_at", table_name="stock_movements")
    op.drop_constraint("fk_stock_movements_document_line", "stock_movements", type_="foreignkey")
    op.drop_table("stock_movements")
    op.drop_table("stock_document_items")
    op.drop_table("inventory")
    op.drop_index("ix_stock_documents_type_status_created", table_name="stock_documents")
    op.drop_table("stock_documents")
    op.drop_index("ix_products_category_id", table_name="products")
    op.drop_index("uq_products_barcode", table_name="products")
    op.drop_index("uq_products_sku_lower", table_name="products")
    op.drop_table("products")
    op.drop_index("uq_users_email_lower", table_name="users")
    op.drop_table("users")
    op.drop_index("uq_suppliers_code_lower", table_name="suppliers")
    op.drop_table("suppliers")
    op.drop_index("uq_warehouses_code_lower", table_name="warehouses")
    op.drop_table("warehouses")
    op.drop_index("uq_categories_name_lower", table_name="categories")
    op.drop_table("categories")
    op.drop_table("scanner_sessions")
