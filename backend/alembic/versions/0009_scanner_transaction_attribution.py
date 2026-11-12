"""Attribute scanner-created draft documents to their scan and user.

Revision ID: 0009_scanner_transaction_attribution
Revises: 0008_scanner_gate_attribution
Create Date: 2026-11-12
"""
from alembic import op
import sqlalchemy as sa


revision = "0009_scanner_transaction_attribution"
down_revision = "0008_scanner_gate_attribution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stock_documents", sa.Column("scan_point", sa.Text(), nullable=True))
    op.add_column("stock_documents", sa.Column("scan_event_id", sa.Uuid(), nullable=True))
    op.add_column("stock_documents", sa.Column("client_timestamp", sa.DateTime(timezone=True), nullable=True))
    op.add_column("stock_documents", sa.Column("created_by_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_stock_documents_created_by_user_id_users",
        "stock_documents",
        "users",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint("uq_stock_documents_scan_event_id", "stock_documents", ["scan_event_id"])
    op.create_check_constraint(
        "ck_stock_documents_scan_point",
        "stock_documents",
        "scan_point IS NULL OR scan_point IN ('GATE_A', 'GATE_B')",
    )
    op.create_check_constraint(
        "ck_stock_documents_scan_point_type",
        "stock_documents",
        "scan_point IS NULL OR (scan_point = 'GATE_A' AND type = 'Nhập kho') OR (scan_point = 'GATE_B' AND type = 'Xuất kho')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_stock_documents_scan_point_type", "stock_documents", type_="check")
    op.drop_constraint("ck_stock_documents_scan_point", "stock_documents", type_="check")
    op.drop_constraint("uq_stock_documents_scan_event_id", "stock_documents", type_="unique")
    op.drop_constraint("fk_stock_documents_created_by_user_id_users", "stock_documents", type_="foreignkey")
    op.drop_column("stock_documents", "created_by_user_id")
    op.drop_column("stock_documents", "client_timestamp")
    op.drop_column("stock_documents", "scan_event_id")
    op.drop_column("stock_documents", "scan_point")
