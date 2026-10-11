"""Normalize product SKU and barcode uniqueness by trimming whitespace.

Revision ID: 0003_normalize_product_ids
Revises: 0002_product_sku_supplier
Create Date: 2026-10-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_normalize_product_ids"
down_revision = "0002_product_sku_supplier"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not op.get_context().as_sql:
        connection = op.get_bind()
        duplicate_skus = connection.execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM products
                    GROUP BY lower(btrim(sku))
                    HAVING count(*) > 1
                )
                """
            )
        ).scalar_one()
        duplicate_barcodes = connection.execute(
            sa.text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM products
                    WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
                    GROUP BY btrim(barcode)
                    HAVING count(*) > 1
                )
                """
            )
        ).scalar_one()
        if duplicate_skus or duplicate_barcodes:
            raise RuntimeError(
                "Không thể chuẩn hóa unique SKU/barcode: phát hiện mã trùng sau khi loại khoảng trắng. "
                "Hãy xử lý dữ liệu trùng có kiểm soát rồi chạy migration lại."
            )

    op.drop_index("uq_products_sku_lower", table_name="products")
    op.create_index(
        "uq_products_sku_lower",
        "products",
        [sa.text("lower(btrim(sku))")],
        unique=True,
    )
    op.drop_index("uq_products_barcode", table_name="products")
    op.create_index(
        "uq_products_barcode",
        "products",
        [sa.text("btrim(barcode)")],
        unique=True,
        postgresql_where=sa.text("barcode IS NOT NULL AND btrim(barcode) <> ''"),
    )


def downgrade() -> None:
    op.drop_index("uq_products_barcode", table_name="products")
    op.create_index(
        "uq_products_barcode",
        "products",
        ["barcode"],
        unique=True,
        postgresql_where=sa.text("barcode IS NOT NULL AND barcode <> ''"),
    )
    op.drop_index("uq_products_sku_lower", table_name="products")
    op.create_index("uq_products_sku_lower", "products", [sa.text("lower(sku)")], unique=True)
