from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.auth import create_access_token, hash_password, hash_token, new_csrf_token, new_refresh_token, verify_password
from app.core.config import settings
from app.core.errors import ApiError
from app.core.rbac import CurrentUser
from app.db.session import get_db
from app.models import AuditLog, AuthSession, User
from app.services.audit_context import set_actor_name
from app.services.serialization import user_dict

router = APIRouter(prefix="/auth", tags=["authentication"])
_REFRESH_COOKIE = "warehouse_refresh"
_CSRF_COOKIE = "warehouse_csrf"


class LoginInput(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        import re

        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Email không hợp lệ.")
        return value.lower()


class PasswordInput(BaseModel):
    password: str = Field(min_length=12, max_length=128)


def _set_session_cookies(response: Response, refresh_token: str, csrf_token: str) -> None:
    secure = settings.app_env.lower() in {"production", "prod"}
    same_site = "none" if secure else "lax"
    response.set_cookie(_REFRESH_COOKIE, refresh_token, max_age=settings.auth_refresh_ttl_seconds, httponly=True, secure=secure, samesite=same_site, path="/api/v1/auth", domain=settings.auth_cookie_domain or None)
    response.set_cookie(_CSRF_COOKIE, csrf_token, max_age=settings.auth_refresh_ttl_seconds, httponly=False, secure=secure, samesite=same_site, path="/", domain=settings.auth_cookie_domain or None)


def _clear_session_cookies(response: Response) -> None:
    secure = settings.app_env.lower() in {"production", "prod"}
    same_site = "none" if secure else "lax"
    response.delete_cookie(_REFRESH_COOKIE, path="/api/v1/auth", secure=secure, httponly=True, samesite=same_site, domain=settings.auth_cookie_domain or None)
    response.delete_cookie(_CSRF_COOKIE, path="/", secure=secure, httponly=False, samesite=same_site, domain=settings.auth_cookie_domain or None)


def _require_csrf(request: Request, csrf_header: str | None) -> None:
    cookie = request.cookies.get(_CSRF_COOKIE)
    origin = request.headers.get("origin")
    if origin:
        _validate_origin(origin)
    if not cookie or not csrf_header or not hmac_compare(cookie, csrf_header):
        raise ApiError(403, "CSRF_VALIDATION_FAILED", "Thiếu hoặc sai mã bảo vệ CSRF.")


def hmac_compare(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left, right)


def _validate_origin(origin: str) -> None:
    allowed_origins = set(settings.cors_origin_list)
    if origin in allowed_origins:
        return
    import re

    if not settings.cors_origin_regex or not re.fullmatch(settings.cors_origin_regex, origin):
        raise ApiError(403, "INVALID_ORIGIN", "Yêu cầu đến từ origin không được phép.")


@router.post("/login")
def login(payload: LoginInput, response: Response, request: Request, db: Session = Depends(get_db)):
    origin = request.headers.get("origin")
    if origin:
        _validate_origin(origin)
    email = str(payload.email).lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user or not user.active or not verify_password(payload.password, user.password_hash):
        raise ApiError(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không chính xác.")
    refresh_token, csrf_token = new_refresh_token(), new_csrf_token()
    session = AuthSession(user_id=user.id, refresh_token_hash=hash_token(refresh_token), csrf_token_hash=hash_token(csrf_token), expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.auth_refresh_ttl_seconds))
    db.add(session)
    db.flush()
    set_actor_name(db, user.name)
    db.add(AuditLog(message=f"Đăng nhập tài khoản {user.email}", actor_name=user.name, action="Đăng nhập", outcome="success", status_code=200))
    response.headers["Cache-Control"] = "no-store"
    _set_session_cookies(response, refresh_token, csrf_token)
    return {"accessToken": create_access_token(user.id, session.id), "user": user_dict(user), "csrfToken": csrf_token}


@router.get("/csrf")
def csrf_token(request: Request, response: Response):
    origin = request.headers.get("origin")
    if origin:
        _validate_origin(origin)
    token = request.cookies.get(_CSRF_COOKIE)
    if not token:
        raise ApiError(401, "SESSION_EXPIRED", "Chưa có phiên đăng nhập cần khôi phục.")
    response.headers["Cache-Control"] = "no-store"
    return {"csrfToken": token}


@router.post("/refresh")
def refresh(request: Request, response: Response, x_csrf_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    _require_csrf(request, x_csrf_token)
    raw_token = request.cookies.get(_REFRESH_COOKIE)
    if not raw_token:
        raise ApiError(401, "SESSION_EXPIRED", "Phiên đăng nhập đã hết hạn.")
    session = db.scalar(select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(raw_token)).with_for_update())
    now = datetime.now(timezone.utc)
    session_expiry = session.expires_at if session and session.expires_at.tzinfo else session.expires_at.replace(tzinfo=timezone.utc) if session else now
    if not session or session.revoked_at or session_expiry <= now:
        raise ApiError(401, "SESSION_EXPIRED", "Phiên đăng nhập đã hết hạn.")
    if not hmac_compare(session.csrf_token_hash, hash_token(x_csrf_token or "")):
        raise ApiError(403, "CSRF_VALIDATION_FAILED", "Mã bảo vệ CSRF không hợp lệ.")
    user = db.scalar(select(User).where(User.id == session.user_id))
    if not user or not user.active:
        session.revoked_at = now
        _clear_session_cookies(response)
        raise ApiError(401, "SESSION_EXPIRED", "Tài khoản không còn hoạt động.")
    refresh_token, csrf_token = new_refresh_token(), new_csrf_token()
    session.refresh_token_hash = hash_token(refresh_token)
    session.csrf_token_hash = hash_token(csrf_token)
    session.expires_at = now + timedelta(seconds=settings.auth_refresh_ttl_seconds)
    set_actor_name(db, user.name)
    _set_session_cookies(response, refresh_token, csrf_token)
    response.headers["Cache-Control"] = "no-store"
    return {"accessToken": create_access_token(user.id, session.id), "user": user_dict(user), "csrfToken": csrf_token}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, x_csrf_token: str | None = Header(default=None), db: Session = Depends(get_db)):
    _require_csrf(request, x_csrf_token)
    raw_token = request.cookies.get(_REFRESH_COOKIE)
    if raw_token:
        session = db.scalar(select(AuthSession).where(AuthSession.refresh_token_hash == hash_token(raw_token), AuthSession.revoked_at.is_(None)).with_for_update())
        if session:
            session.revoked_at = datetime.now(timezone.utc)
            user = db.scalar(select(User).where(User.id == session.user_id))
            actor = user.name if user else "Hệ thống"
            db.add(AuditLog(message=f"Đăng xuất tài khoản {user.email if user else ''}".strip(), actor_name=actor, action="Đăng xuất", outcome="success", status_code=204))
    _clear_session_cookies(response)


@router.get("/me")
def me(user: CurrentUser):
    return user_dict(user)


@router.put("/users/{user_id}/password", status_code=204)
def set_user_password(user_id: UUID, payload: PasswordInput, current_user: CurrentUser, db: Session = Depends(get_db)):
    if current_user.role != "Quản trị viên":
        raise ApiError(403, "FORBIDDEN", "Chỉ quản trị viên được đặt lại mật khẩu.")
    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target:
        raise ApiError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng.")
    target.password_hash = hash_password(payload.password)
    db.execute(update(AuthSession).where(AuthSession.user_id == target.id, AuthSession.revoked_at.is_(None)).values(revoked_at=datetime.now(timezone.utc)))
    db.add(AuditLog(message=f"Đặt lại mật khẩu tài khoản {target.email}", actor_name=current_user.name, action="Đặt lại mật khẩu", outcome="success"))
