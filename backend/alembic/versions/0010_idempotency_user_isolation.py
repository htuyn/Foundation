"""Scope idempotency requests by authenticated user and idempotency key.

Revision ID: 0010_idempotency_user_isolation
Revises: 0009_scanner_tx_attr
Create Date: 2026-11-22
"""
from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0010_idempotency_user_isolation"
down_revision = "0009_scanner_tx_attr"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Thêm cột user_id tạm thời cho phép null
    op.add_column("idempotency_requests", sa.Column("user_id", sa.Uuid(), nullable=True))

    # 2. Backfill user_id từ stock_documents (thông qua document id lưu trong response_json)
    op.execute(
        sa.text(
            """
            UPDATE idempotency_requests ir
            SET user_id = sd.created_by_user_id
            FROM stock_documents sd
            WHERE ir.user_id IS NULL
              AND ir.response_json IS NOT NULL
              AND (ir.response_json->>'id') IS NOT NULL
              AND (ir.response_json->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND sd.id = (ir.response_json->>'id')::uuid
              AND sd.created_by_user_id IS NOT NULL
            """
        )
    )

    # 3. Backfill bổ sung từ audit_logs nếu còn bản ghi chưa gắn user_id
    # Chỉ gán khi tên user là duy nhất trong hệ thống và audit log xác định chính xác 1 user duy nhất cho document
    op.execute(
        sa.text(
            """
            WITH unique_users AS (
                SELECT id, name
                FROM users
                WHERE name IN (
                    SELECT name
                    FROM users
                    GROUP BY name
                    HAVING count(*) = 1
                )
            ),
            doc_single_actor AS (
                SELECT (al.details->>'documentId') AS doc_id, min(uu.id::text)::uuid AS single_user_id
                FROM audit_logs al
                JOIN unique_users uu ON uu.name = al.actor_name
                WHERE al.action = 'POST /api/v1/documents'
                  AND al.actor_name <> 'Hệ thống'
                  AND al.details IS NOT NULL
                  AND (al.details->>'documentId') IS NOT NULL
                GROUP BY (al.details->>'documentId')
                HAVING count(DISTINCT uu.id) = 1
            )
            UPDATE idempotency_requests ir
            SET user_id = dsa.single_user_id
            FROM doc_single_actor dsa
            WHERE ir.user_id IS NULL
              AND ir.response_json IS NOT NULL
              AND (ir.response_json->>'id') IS NOT NULL
              AND (ir.response_json->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND (ir.response_json->>'id') = dsa.doc_id
            """
        )
    )

    # 4. Kiểm tra dữ liệu lịch sử còn sót không thể xác định user an toàn (ở online mode)
    if not context.is_offline_mode():
        bind = op.get_bind()
        unmigrated_count = bind.execute(
            sa.text("SELECT count(*) FROM idempotency_requests WHERE user_id IS NULL")
        ).scalar()
        if unmigrated_count and unmigrated_count > 0:
            raise RuntimeError(
                f"Phát hiện {unmigrated_count} bản ghi idempotency_requests cũ không thể xác định chủ sở hữu user_id an toàn "
                "(tên user không duy nhất, audit log mơ hồ hoặc thiếu thông tin liên kết phiếu). "
                "Dữ liệu được giữ nguyên. Vui lòng kiểm tra và xử lý trước khi áp dụng migration."
            )

    # 5. Đặt NOT NULL cho user_id
    op.alter_column("idempotency_requests", "user_id", nullable=False)

    # 6. Chuyển Primary Key từ (idempotency_key) sang composite (user_id, idempotency_key)
    op.drop_constraint("pk_idempotency_requests", "idempotency_requests", type_="primary")
    op.create_primary_key(
        "pk_idempotency_requests",
        "idempotency_requests",
        ["user_id", "idempotency_key"],
    )

    # 7. Thêm Foreign Key tới bảng users(id) ON DELETE CASCADE
    op.create_foreign_key(
        "fk_idempotency_requests_user_id_users",
        "idempotency_requests",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 8. Thêm index phục vụ truy vấn theo user_id và thời gian
    op.create_index(
        "ix_idempotency_requests_user_created",
        "idempotency_requests",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_idempotency_requests_user_created", table_name="idempotency_requests")
    op.drop_constraint("fk_idempotency_requests_user_id_users", "idempotency_requests", type_="foreignkey")
    op.drop_constraint("pk_idempotency_requests", "idempotency_requests", type_="primary")
    op.create_primary_key(
        "pk_idempotency_requests",
        "idempotency_requests",
        ["idempotency_key"],
    )
    op.drop_column("idempotency_requests", "user_id")
