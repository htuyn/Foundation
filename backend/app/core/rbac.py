"""RBAC middleware dependency cho FastAPI.

Cơ chế:
  - Client gửi header  X-User-Id: <uuid>  mỗi request
  - Middleware tra DB lấy User, kiểm tra active và role
  - Nếu thiếu header hoặc user không tồn tại → 401
  - Nếu role không đủ quyền → 403 + ghi Audit Log

Ma trận phân quyền (roadmap SV4 – CV02):
  Role              | GET | POST | PUT/PATCH | DELETE | inventory/adjust | documents/confirm|cancel
  ------------------|-----|------|-----------|--------|------------------|------------------
  Quản trị viên     |  ✓  |  ✓   |     ✓     |   ✓    |        ✓         |        ✓
  Quản lý kho       |  ✓  |  ✓   |     ✓     |   ✓    |        ✓         |        ✓
  Nhân viên kho     |  ✓  |  ✓   |     ✓     |   ✗    |        ✓         |        ✓
  Chỉ xem           |  ✓  |  ✗   |     ✗     |   ✗    |        ✗         |        ✗

Quy tắc:
  - GET /health*, GET /api/v1/bootstrap → public (không cần header)
  - Scanner endpoints (/scanner/*) → public (xác thực qua QR token riêng)
  - Tất cả endpoint còn lại → bắt buộc X-User-Id
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.db.session import get_db
from app.models import AuditLog, User

# ---------------------------------------------------------------------------
# Các endpoint được miễn xác thực (prefix match)
# ---------------------------------------------------------------------------
_PUBLIC_PREFIXES = (
    "/health",
    "/api/v1/scanner",   # scanner dùng QR token riêng
    "/api/v1/bootstrap", # tải dữ liệu khởi động
)

# ---------------------------------------------------------------------------
# Danh sách role được phép thực hiện từng method
# ---------------------------------------------------------------------------
# GET: tất cả role (kể cả Chỉ xem)
# POST / PUT / PATCH: Quản trị viên, Quản lý kho, Nhân viên kho
# DELETE: Quản trị viên, Quản lý kho
_ROLES_WRITE = {"Quản trị viên", "Quản lý kho", "Nhân viên kho"}
_ROLES_DELETE = {"Quản trị viên", "Quản lý kho"}
_ROLES_ALL = {"Quản trị viên", "Quản lý kho", "Nhân viên kho", "Chỉ xem"}

ROLE_METHOD_MAP: dict[str, set[str]] = {
    "GET": _ROLES_ALL,
    "HEAD": _ROLES_ALL,
    "OPTIONS": _ROLES_ALL,
    "POST": _ROLES_WRITE,
    "PUT": _ROLES_WRITE,
    "PATCH": _ROLES_WRITE,
    "DELETE": _ROLES_DELETE,
}


# ---------------------------------------------------------------------------
# Helper: ghi audit log từ chối
# ---------------------------------------------------------------------------
def _write_deny_log(db: Session, user: User, method: str, path: str) -> None:
    """Ghi vào audit_logs khi request bị 403."""
    db.add(
        AuditLog(
            message=f"[RBAC DENY] {user.role} | {method} {path}",
            actor_name=user.name,
        )
    )
    db.flush()


# ---------------------------------------------------------------------------
# Dependency: resolve user từ X-User-Id header
# ---------------------------------------------------------------------------
def get_current_user(
    request: Request,
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency – trả về User đang thực hiện request.

    Raise 401 nếu thiếu header hoặc user không hợp lệ.
    Raise 403 nếu user bị vô hiệu hoá.
    Không kiểm tra quyền ở đây – dùng require_roles() cho việc đó.
    """
    path: str = request.url.path

    # Skip auth cho public endpoints
    if any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES):
        # Trả về một sentinel user "Hệ thống" để các endpoint public
        # vẫn có thể ghi audit log với actor_name = "Hệ thống"
        return _SYSTEM_USER

    if not x_user_id:
        raise ApiError(401, "MISSING_USER_HEADER", "Yêu cầu header X-User-Id.")

    try:
        uid = UUID(x_user_id)
    except ValueError:
        raise ApiError(401, "INVALID_USER_ID", "X-User-Id không phải UUID hợp lệ.")

    user = db.scalar(select(User).where(User.id == uid))
    if not user:
        raise ApiError(401, "USER_NOT_FOUND", "Không tìm thấy tài khoản.")
    if not user.active:
        raise ApiError(403, "USER_INACTIVE", "Tài khoản đã bị vô hiệu hoá.")

    return user


# ---------------------------------------------------------------------------
# Sentinel user dùng cho public / scanner endpoints
# ---------------------------------------------------------------------------
class _SystemUser:
    """Giả user 'Hệ thống' cho các request không cần xác thực."""
    id = None
    name = "Hệ thống"
    role = "Quản trị viên"   # public endpoints không bị chặn RBAC
    active = True
    email = ""

_SYSTEM_USER = _SystemUser()  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Dependency factory: kiểm tra quyền theo method (tự động)
# ---------------------------------------------------------------------------
def require_permission(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> User:
    """Dependency kiểm tra quyền dựa theo HTTP method và role của user.

    Ghi Audit Log khi bị từ chối (403), theo yêu cầu CV02 và SV3 Audit Log.
    """
    # Public sentinel → cho qua
    if user is _SYSTEM_USER:
        return user

    method = request.method.upper()
    path = request.url.path
    allowed_roles = ROLE_METHOD_MAP.get(method, _ROLES_DELETE)

    if user.role not in allowed_roles:
        _write_deny_log(db, user, method, path)
        raise ApiError(
            403,
            "FORBIDDEN",
            f"Vai trò '{user.role}' không được phép thực hiện {method} {path}.",
        )

    return user


# ---------------------------------------------------------------------------
# Type alias tiện dụng để dùng trong endpoint signature
# ---------------------------------------------------------------------------
CurrentUser = Annotated[User, Depends(require_permission)]
