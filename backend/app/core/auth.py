import base64
import hashlib
import hmac
import json
import secrets
import time
from uuid import UUID

from app.core.config import settings


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    if len(password) < 12 or len(password) > 128:
        raise ValueError("Mật khẩu phải có từ 12 đến 128 ký tự.")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=32768, r=8, p=1, dklen=32, maxmem=128 * 1024 * 1024)
    return f"scrypt$32768$8$1${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded or len(password) > 128:
        return False
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(password.encode("utf-8"), salt=_b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32, maxmem=128 * 1024 * 1024)
        return hmac.compare_digest(actual, _b64decode(expected))
    except (ValueError, TypeError):
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_access_token(user_id: UUID, session_id: UUID) -> str:
    now = int(time.time())
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64encode(json.dumps({"sub": str(user_id), "sid": str(session_id), "iat": now, "exp": now + settings.auth_access_ttl_seconds}, separators=(",", ":")).encode())
    signed = f"{header}.{payload}"
    signature = hmac.new(settings.signing_key.encode(), signed.encode(), hashlib.sha256).digest()
    return f"{signed}.{_b64encode(signature)}"


def decode_access_token(token: str) -> tuple[UUID, UUID] | None:
    try:
        header, payload, signature = token.split(".")
        header_claims = json.loads(_b64decode(header))
        if header_claims != {"alg": "HS256", "typ": "JWT"}:
            return None
        signed = f"{header}.{payload}"
        expected = hmac.new(settings.signing_key.encode(), signed.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature)):
            return None
        claims = json.loads(_b64decode(payload))
        if int(claims["exp"]) <= int(time.time()):
            return None
        return UUID(claims["sub"]), UUID(claims["sid"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)
