"""Add 'Chỉ xem' role to users constraint and seed viewer demo account.

Revision ID: 0005_rbac_viewer_role
Revises: 0004_scanner_code_39
Create Date: 2026-10-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_rbac_viewer_role"
down_revision = "0004_scanner_code_39"
branch_labels = None
depends_on = None

_OLD_CONSTRAINT = "ck_users_role"
_NEW_CHECK = "role IN ('Quản trị viên', 'Quản lý kho', 'Nhân viên kho', 'Chỉ xem')"


def upgrade() -> None:
    # Drop old CHECK constraint, add new one that includes 'Chỉ xem'
    op.drop_constraint(_OLD_CONSTRAINT, "users", type_="check")
    op.create_check_constraint(_OLD_CONSTRAINT, "users", _NEW_CHECK)


def downgrade() -> None:
    # Remove 'Chỉ xem' accounts first to avoid constraint violation
    op.execute("DELETE FROM users WHERE role = 'Chỉ xem'")
    op.drop_constraint(_OLD_CONSTRAINT, "users", type_="check")
    op.create_check_constraint(
        _OLD_CONSTRAINT,
        "users",
        "role IN ('Quản trị viên', 'Quản lý kho', 'Nhân viên kho')",
    )
