"""Add gate and authenticated-user attribution to scanner records.

Revision ID: 0008_scanner_gate_attribution
Revises: 0007_user_auth_sessions
Create Date: 2026-11-12
"""
from alembic import op
import sqlalchemy as sa


revision = "0008_scanner_gate_attribution"
down_revision = "0007_user_auth_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scanner_sessions", sa.Column("gate_id", sa.Text(), nullable=True))
    op.add_column("scanner_sessions", sa.Column("owner_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_scanner_sessions_owner_user_id_users",
        "scanner_sessions",
        "users",
        ["owner_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("scan_events", sa.Column("gate_id", sa.Text(), nullable=True))
    op.add_column("scan_events", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.add_column("scan_events", sa.Column("server_timestamp", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_scan_events_user_id_users",
        "scan_events",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint(
        "ck_scanner_sessions_gate_id",
        "scanner_sessions",
        "gate_id IS NULL OR gate_id IN ('GATE_A', 'GATE_B')",
    )
    op.create_check_constraint(
        "ck_scan_events_gate_id",
        "scan_events",
        "gate_id IS NULL OR gate_id IN ('GATE_A', 'GATE_B')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_scan_events_gate_id", "scan_events", type_="check")
    op.drop_constraint("ck_scanner_sessions_gate_id", "scanner_sessions", type_="check")
    op.drop_constraint("fk_scan_events_user_id_users", "scan_events", type_="foreignkey")
    op.drop_column("scan_events", "server_timestamp")
    op.drop_column("scan_events", "user_id")
    op.drop_column("scan_events", "gate_id")
    op.drop_constraint("fk_scanner_sessions_owner_user_id_users", "scanner_sessions", type_="foreignkey")
    op.drop_column("scanner_sessions", "owner_user_id")
    op.drop_column("scanner_sessions", "gate_id")
