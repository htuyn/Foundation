"""Allow Code 39 scanner events.

Revision ID: 0004_scanner_code_39
Revises: 0003_normalize_product_ids
Create Date: 2026-10-10
"""
from alembic import op


revision = "0004_scanner_code_39"
down_revision = "0003_normalize_product_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_scan_events_format", "scan_events", type_="check")
    op.create_check_constraint(
        "ck_scan_events_format",
        "scan_events",
        "format IN ('EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'CODE_39', 'QR_CODE', 'MANUAL')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_scan_events_format", "scan_events", type_="check")
    op.create_check_constraint(
        "ck_scan_events_format",
        "scan_events",
        "format IN ('EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_128', 'QR_CODE', 'MANUAL')",
    )
