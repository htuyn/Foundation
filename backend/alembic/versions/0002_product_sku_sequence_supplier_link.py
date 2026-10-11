"""Add a sequence-backed product SKU and supplier relation on stock documents.

Revision ID: 0002_product_sku_supplier
Revises: 0001_initial_schema
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_product_sku_supplier"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE product_sku_seq AS BIGINT START WITH 1 INCREMENT BY 1")
    op.execute(
        """
        SELECT setval(
            'product_sku_seq',
            COALESCE(MAX(substring(upper(sku) FROM 4)::bigint), 0) + 1,
            false
        )
        FROM products
        WHERE upper(sku) ~ '^SP-[0-9]+$'
        """
    )

    op.add_column("stock_documents", sa.Column("supplier_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_stock_documents_supplier_id_suppliers",
        "stock_documents",
        "suppliers",
        ["supplier_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_stock_documents_supplier_id", "stock_documents", ["supplier_id"])
    op.execute(
        """
        CREATE FUNCTION require_inbound_document_supplier() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.type = 'Nhập kho' AND NEW.supplier_id IS NULL THEN
                RAISE EXCEPTION 'Phiếu nhập kho phải liên kết nhà cung cấp.'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_stock_documents_inbound_supplier_required';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_stock_documents_require_supplier
        BEFORE INSERT OR UPDATE OF type, supplier_id ON stock_documents
        FOR EACH ROW EXECUTE FUNCTION require_inbound_document_supplier()
        """
    )


def downgrade() -> None:
    connection = op.get_bind()
    linked_documents = connection.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM stock_documents WHERE supplier_id IS NOT NULL)")
    ).scalar_one()
    if linked_documents:
        raise RuntimeError("Không thể downgrade khi phiếu đã lưu liên kết nhà cung cấp.")

    op.execute("DROP TRIGGER trg_stock_documents_require_supplier ON stock_documents")
    op.execute("DROP FUNCTION require_inbound_document_supplier()")
    op.drop_index("ix_stock_documents_supplier_id", table_name="stock_documents")
    op.drop_constraint("fk_stock_documents_supplier_id_suppliers", "stock_documents", type_="foreignkey")
    op.drop_column("stock_documents", "supplier_id")
    op.execute("DROP SEQUENCE product_sku_seq")
