"""Add request idempotency and structured audit outcomes.

Revision ID: 0005_idempotency_audit
Revises: 0004_scanner_code_39
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0005_idempotency_audit"
down_revision = "0004_scanner_code_39"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("action", sa.Text(), server_default="operation", nullable=False))
    op.add_column("audit_logs", sa.Column("outcome", sa.Text(), server_default="success", nullable=False))
    op.add_column("audit_logs", sa.Column("status_code", sa.Integer(), server_default="200", nullable=False))
    op.add_column("audit_logs", sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
    op.create_check_constraint(
        "ck_audit_logs_outcome", "audit_logs", "outcome IN ('success', 'rejected', 'replayed')"
    )
    op.create_table(
        "idempotency_requests",
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=False),
        sa.Column("response_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("idempotency_key", name="pk_idempotency_requests"),
    )


def downgrade() -> None:
    op.drop_table("idempotency_requests")
    op.drop_constraint("ck_audit_logs_outcome", "audit_logs", type_="check")
    op.drop_column("audit_logs", "details")
    op.drop_column("audit_logs", "status_code")
    op.drop_column("audit_logs", "outcome")
    op.drop_column("audit_logs", "action")
