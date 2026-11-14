"""RBAC middleware dependency cho FastAPI.

Cơ chế:
  - Client gửi access token ký số trong Authorization: Bearer mỗi request
  - Backend xác minh chữ ký, tra DB và kiểm tra tài khoản active/role
  - Token sai/hết hạn hoặc user không tồn tại → 401
  - Nếu role không đủ quyền → 403 + ghi Audit Log
  - Nếu thiếu token hoặc session hết hạn → 401 + ghi Audit Log

Ma trận phân quyền (roadmap SV4 – CV02):
  Role                   | Alias DB          | GET | POST | PUT/PATCH | DELETE
  -----------------------|-------------------|-----|------|-----------|-------
  Quản trị viên          | admin             |  ✓  |  ✓   |     ✓     |   ✓
  Thủ kho                | storekeeper       |  ✓  |  ✓   |     ✓     |   ✓
  Nhân viên quét mã      | scanner           |  ✓  |  ✓   |     ✓     |   ✗
  Chỉ xem                | viewer            |  ✓  |  ✗   |     ✗     |   ✗

Quy tắc:
  - GET /health* → public
  - Scanner endpoints (/scanner/*) → public (xác thực qua QR token riêng)
  - Tất cả endpoint nghiệp vụ → bắt buộc access token
  - Tài khoản 'Chỉ xem' thực hiện POST/PUT/PATCH/DELETE → HTTP 403 ngay lập tức
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.core.auth import decode_access_token
from app.db.session import get_db
from app.models import AuditLog, AuthSession, User

# ---------------------------------------------------------------------------
# Các endpoint được miễn xác thực (prefix match)
# ---------------------------------------------------------------------------
_PUBLIC_PREFIXES = ("/health", "/api/v1/scanner")

# ---------------------------------------------------------------------------
# Hằng số tên vai trò – khớp 1-1 với CHECK CONSTRAINT trong bảng users
# ---------------------------------------------------------------------------
ROLE_ADMIN       = "Quản trị viên"      # admin
ROLE_STOREKEEPER = "Thủ kho"            # storekeeper
ROLE_SCANNER     = "Nhân viên quét mã"  # scanner
ROLE_VIEWER      = "Chỉ xem"            # viewer

# Tập hợp tất cả vai trò hợp lệ được hệ thống nhận biết
VALID_ROLES: frozenset[str] = frozenset({
    ROLE_ADMIN,
    ROLE_STOREKEEPER,
    ROLE_SCANNER,
    ROLE_VIEWER,
})

# ---------------------------------------------------------------------------
# Ma trận phân quyền theo HTTP method
# ---------------------------------------------------------------------------
# GET / HEAD / OPTIONS : tất cả vai trò (kể cả Chỉ xem)
# POST / PUT / PATCH   : Admin, Thủ kho, Nhân viên quét mã
# DELETE               : Admin, Thủ kho
_ROLES_READ_ONLY = frozenset({ROLE_ADMIN, ROLE_STOREKEEPER, ROLE_SCANNER, ROLE_VIEWER})
_ROLES_WRITE     = frozenset({ROLE_ADMIN, ROLE_STOREKEEPER, ROLE_SCANNER})
_ROLES_DELETE    = frozenset({ROLE_ADMIN, ROLE_STOREKEEPER})

# HTTP methods gây thay đổi dữ liệu – viewer bị chặn tất cả các method này
MUTATING_METHODS: frozenset[str] = frozenset({"POST", "PUT", "PATCH", "DELETE"})

ROLE_METHOD_MAP: dict[str, frozenset[str]] = {
    "GET":     _ROLES_READ_ONLY,
    "HEAD":    _ROLES_READ_ONLY,
    "OPTIONS": _ROLES_READ_ONLY,
    "POST":    _ROLES_WRITE,
    "PUT":     _ROLES_WRITE,
    "PATCH":   _ROLES_WRITE,
    "DELETE":  _ROLES_DELETE,
}


# ---------------------------------------------------------------------------
# Helper: ghi audit log từ chối (403 / 401)
# ---------------------------------------------------------------------------
def _write_deny_log(
    db: Session,
    actor_name: str,
    method: str,
    path: str,
    status_code: int,
    reason: str,
    role: str | None = None,
) -> None:
    """Ghi vào bảng audit_logs khi request bị từ chối (401 hoặc 403).

    Các trường được fill đầy đủ theo schema audit_logs:
      - actor_name  : tên người dùng (hoặc "Ẩn danh" nếu chưa xác thực)
      - action      : "<METHOD> <path>"
      - outcome     : "rejected"
      - status_code : 401 hoặc 403
      - message     : mô tả ngắn gọn lý do từ chối
      - details     : JSON chứa role, reason để tra cứu sau
    """
    db.add(
        AuditLog(
            id=uuid4(),
            message=f"[RBAC DENY {status_code}] {actor_name} | {method} {path} | {reason}",
            actor_name=actor_name,
            action=f"{method} {path}",
            outcome="rejected",
            status_code=status_code,
            details={
                "role": role,
                "reason": reason,
                "method": method,
                "path": path,
            },
        )
    )
    db.flush()


# ---------------------------------------------------------------------------
# Dependency: resolve user từ bearer access token
# ---------------------------------------------------------------------------
def get_current_user(
    request: Request,
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency – trả về User đang thực hiện request.

    Raise 401 nếu thiếu header, token sai, hoặc session hết hạn/bị thu hồi.
    Raise 403 nếu user bị vô hiệu hoá.
    Không kiểm tra quyền ở đây – dùng require_permission() cho việc đó.

    Ghi Audit Log cho các lỗi 401 với thông tin request đủ để trace.
    """
    path: str = request.url.path
    method: str = request.method.upper()

    # Skip auth cho public endpoints
    if any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES):
        # Trả về sentinel user "Hệ thống" để các endpoint public
        # vẫn có thể ghi audit log với actor_name = "Hệ thống"
        return _SYSTEM_USER

    if not authorization or not authorization.startswith("Bearer "):
        _write_deny_log(db, "Ẩn danh", method, path, 401, "MISSING_ACCESS_TOKEN")
        raise ApiError(401, "MISSING_ACCESS_TOKEN", "Yêu cầu access token hợp lệ.")

    token_claims = decode_access_token(authorization.removeprefix("Bearer ").strip())
    if token_claims is None:
        _write_deny_log(db, "Ẩn danh", method, path, 401, "INVALID_ACCESS_TOKEN")
        raise ApiError(401, "INVALID_ACCESS_TOKEN", "Access token không hợp lệ hoặc đã hết hạn.")

    uid, session_id = token_claims
    auth_session = db.scalar(
        select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == uid)
    )
    now = datetime.now(timezone.utc)
    if auth_session and auth_session.expires_at.tzinfo is None:
        session_expiry = auth_session.expires_at.replace(tzinfo=timezone.utc)
    elif auth_session:
        session_expiry = auth_session.expires_at
    else:
        session_expiry = now

    if not auth_session or auth_session.revoked_at or session_expiry <= now:
        _write_deny_log(db, "Ẩn danh", method, path, 401, "SESSION_EXPIRED")
        raise ApiError(401, "SESSION_EXPIRED", "Phiên đăng nhập đã hết hạn hoặc bị thu hồi.")

    user = db.scalar(select(User).where(User.id == uid))
    if not user:
        _write_deny_log(db, "Ẩn danh", method, path, 401, "USER_NOT_FOUND")
        raise ApiError(401, "USER_NOT_FOUND", "Không tìm thấy tài khoản.")
    if not user.active:
        _write_deny_log(db, user.name, method, path, 403, "USER_INACTIVE", role=user.role)
        raise ApiError(403, "USER_INACTIVE", "Tài khoản đã bị vô hiệu hoá.")

    request.state.actor_name = user.name
    return user


# ---------------------------------------------------------------------------
# Sentinel user dùng cho public / scanner endpoints
# ---------------------------------------------------------------------------
class _SystemUser:
    """Giả user 'Hệ thống' cho các request không cần xác thực."""
    id = None
    name = "Hệ thống"
    role = ROLE_ADMIN   # public endpoints không bị chặn RBAC
    active = True
    email = ""

_SYSTEM_USER = _SystemUser()  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Dependency: kiểm tra quyền theo HTTP method + chặn VIEWER trên mutating methods
# ---------------------------------------------------------------------------
def require_permission(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> User:
    """Dependency kiểm tra quyền dựa theo HTTP method và role của user.

    Logic kiểm tra theo thứ tự ưu tiên:
      1. Public sentinel (_SYSTEM_USER) → cho qua ngay.
      2. Vai trò 'Chỉ xem' (viewer) thực hiện mutating method → 403 ngay lập tức.
      3. Vai trò không nằm trong whitelist của method → 403.

    Mỗi lần từ chối đều ghi vào bảng audit_logs với đầy đủ thông tin.
    """
    # Public sentinel → cho qua
    if user is _SYSTEM_USER:
        return user

    method = request.method.upper()
    path = request.url.path

    # --- Kiểm tra tường minh cho viewer: chặn tất cả mutating methods ---
    if user.role == ROLE_VIEWER and method in MUTATING_METHODS:
        _write_deny_log(
            db, user.name, method, path, 403,
            reason=f"Vai trò '{ROLE_VIEWER}' không được phép thực hiện thao tác thay đổi dữ liệu.",
            role=user.role,
        )
        raise ApiError(
            403,
            "FORBIDDEN",
            f"Tài khoản chỉ xem không được phép thực hiện {method} {path}.",
        )

    # --- Kiểm tra whitelist tổng quát theo ROLE_METHOD_MAP ---
    allowed_roles = ROLE_METHOD_MAP.get(method, _ROLES_DELETE)
    if user.role not in allowed_roles:
        _write_deny_log(
            db, user.name, method, path, 403,
            reason=f"Vai trò '{user.role}' không có trong danh sách được phép với {method}.",
            role=user.role,
        )
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


def require_admin(user: CurrentUser) -> User:
    """Chỉ cho phép Quản trị viên. Dùng cho các route quản lý tài khoản/vai trò."""
    if user.role != ROLE_ADMIN:
        raise ApiError(403, "ADMIN_REQUIRED", "Chỉ quản trị viên được quản lý tài khoản và vai trò.")
    return user


CurrentAdmin = Annotated[User, Depends(require_admin)]
