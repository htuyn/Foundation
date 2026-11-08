"""Merge two 0005 heads: rbac_viewer_role + idempotency_audit.

Revision ID: 0006_merge_heads
Revises: 0005_rbac_viewer_role, 0005_idempotency_audit
Create Date: 2026-11-08
"""

revision = "0006_merge_heads"
down_revision = ("0005_rbac_viewer_role", "0005_idempotency_audit")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
