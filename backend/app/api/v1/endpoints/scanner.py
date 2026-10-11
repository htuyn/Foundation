import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ApiError
from app.db.session import SessionLocal, get_db
from app.models import ScanEvent, ScannerQrTicket, ScannerSession
from app.schemas import ScannerEventInput, ScannerJoinInput
from app.services.scanner_connections import scanner_connections
from app.services.scanner_rate_limit import scanner_rate_limiter

router = APIRouter()
logger = logging.getLogger(__name__)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_view(session: ScannerSession) -> dict:
    return {
        "sessionId": str(session.id),
        "mode": "api",
        "status": session.status,
        "createdAt": session.created_at.isoformat(),
        "expiresAt": session.expires_at.isoformat(),
        "deviceName": session.device_name,
        "connectedAt": session.connected_at.isoformat() if session.connected_at else None,
    }


def require_owner(db: Session, session_id: UUID, bearer: str | None) -> ScannerSession:
    session = db.scalar(select(ScannerSession).where(ScannerSession.id == session_id))
    if not session:
        raise ApiError(404, "SCANNER_SESSION_NOT_FOUND", "Không tìm thấy phiên quét.")
    if not bearer or not hmac.compare_digest(session.owner_token_hash, token_hash(bearer)):
        raise ApiError(403, "SCANNER_OWNER_FORBIDDEN", "Không có quyền quản lý phiên quét này.")
    return session


def check_active(session: ScannerSession) -> None:
    if session.status == "ended":
        raise ApiError(410, "SCANNER_SESSION_ENDED", "Phiên quét đã kết thúc.")
    if datetime.now(timezone.utc) >= session.expires_at:
        session.status = "expired"
        raise ApiError(410, "SCANNER_SESSION_EXPIRED", "Phiên quét đã hết hạn.")


def websocket_auth_failure(session: ScannerSession | None, token: str | None, role: str, now: datetime) -> str | None:
    if not session:
        return "session_not_found"
    if session.status == "ended":
        return "session_closed"
    if now >= session.expires_at:
        return "session_expired"
    if session.status == "expired":
        return "session_expired"
    if role == "owner":
        if session.status not in {"waiting_for_device", "connected"}:
            return "session_not_joinable"
        expected_hash = session.owner_token_hash
    else:
        if session.status != "connected":
            return "device_not_joined"
        expected_hash = session.device_token_hash
    if not token or not expected_hash or not hmac.compare_digest(expected_hash, token_hash(token)):
        return "invalid_token"
    return None


def websocket_bearer(websocket: WebSocket, protocol: str) -> str | None:
    offered = websocket.scope.get("subprotocols")
    if isinstance(offered, list):
        protocols = [item.strip() for item in offered if isinstance(item, str)]
    else:
        protocols = [item.strip() for item in websocket.headers.get("sec-websocket-protocol", "").split(",")]
    return protocols[1] if len(protocols) > 1 and protocols[0] == protocol else None


def store_scan(db: Session, session_id: UUID, payload: ScannerEventInput, bearer: str | None) -> tuple[dict, bool]:
    if payload.sessionId != session_id:
        raise ApiError(422, "SESSION_ID_MISMATCH", "sessionId trong payload không khớp với phiên.")
    with db.begin():
        session = db.scalar(select(ScannerSession).where(ScannerSession.id == session_id).with_for_update())
        if not session:
            raise ApiError(404, "SCANNER_SESSION_NOT_FOUND", "Không tìm thấy phiên quét.")
        check_active(session)
        if session.status != "connected" or not bearer or not session.device_token_hash or not hmac.compare_digest(session.device_token_hash, token_hash(bearer)):
            raise ApiError(403, "SCANNER_DEVICE_FORBIDDEN", "Thiết bị chưa được xác thực trong phiên.")
        scanner_rate_limiter.check(f"scan:{session_id}:{token_hash(bearer)}", 120, 60)
        statement = pg_insert(ScanEvent).values(
            event_id=payload.eventId,
            session_id=session_id,
            barcode=payload.barcode,
            format=payload.format,
            scanned_at=payload.scannedAt,
            device_id=payload.deviceId,
        ).on_conflict_do_nothing(index_elements=[ScanEvent.event_id]).returning(ScanEvent.event_id)
        inserted = db.scalar(statement) is not None
        if not inserted:
            previous = db.get(ScanEvent, payload.eventId)
            if not previous or previous.session_id != session_id or previous.barcode != payload.barcode or previous.format != payload.format:
                raise ApiError(409, "EVENT_ID_CONFLICT", "eventId đã được dùng cho một sự kiện khác.")
    event = {
        "eventId": str(payload.eventId),
        "sessionId": str(session_id),
        "barcode": payload.barcode,
        "format": payload.format,
        "scannedAt": payload.scannedAt.isoformat(),
        "deviceId": payload.deviceId,
    }
    return event, inserted
    if session.status == "expired":
        raise ApiError(410, "SCANNER_SESSION_EXPIRED", "Phiên quét đã hết hạn.")


@router.post("/scanner/sessions", status_code=201)
def create_session(request: Request, db: Session = Depends(get_db)):
    client_host = request.client.host if request.client else "unknown"
    scanner_rate_limiter.check(f"create:{client_host}", 20, 600)
    owner_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    session = ScannerSession(
        mode="api",
        status="waiting_for_device",
        created_at=now,
        expires_at=now + timedelta(seconds=settings.scanner_session_ttl_seconds),
        owner_token_hash=token_hash(owner_token),
    )
    with db.begin():
        db.add(session)
        db.flush()
    return {**session_view(session), "ownerToken": owner_token}


@router.post("/scanner/sessions/{session_id}/qr")
def refresh_qr(session_id: UUID, request: Request, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    bearer = authorization.removeprefix("Bearer ") if authorization else None
    client_host = request.client.host if request.client else "unknown"
    scanner_rate_limiter.check(f"qr-ip:{client_host}", 120, 60)
    with db.begin():
        session = db.scalar(select(ScannerSession).where(ScannerSession.id == session_id).with_for_update())
        if not session:
            raise ApiError(404, "SCANNER_SESSION_NOT_FOUND", "Không tìm thấy phiên quét.")
        if not bearer or not hmac.compare_digest(session.owner_token_hash, token_hash(bearer)):
            raise ApiError(403, "SCANNER_OWNER_FORBIDDEN", "Không có quyền quản lý phiên quét này.")
        scanner_rate_limiter.check(f"qr:{session_id}:{token_hash(bearer)}", 60, 60)
        check_active(session)
        if session.status != "waiting_for_device":
            raise ApiError(409, "SCANNER_SESSION_NOT_WAITING", "Phiên scanner không còn chờ ghép nối.")
        now = datetime.now(timezone.utc)
        tickets = db.scalars(
            select(ScannerQrTicket)
            .where(ScannerQrTicket.session_id == session_id, ScannerQrTicket.consumed_at.is_(None), ScannerQrTicket.revoked_at.is_(None))
            .with_for_update()
        ).all()
        for ticket in tickets:
            ticket.revoked_at = now
        nonce = secrets.token_urlsafe(32)
        expires_at = min(now + timedelta(seconds=settings.scanner_qr_ttl_seconds), session.expires_at)
        ticket = ScannerQrTicket(session_id=session_id, nonce_hash=token_hash(nonce), created_at=now, expires_at=expires_at)
        db.add(ticket)
        db.flush()
    return {"nonce": nonce, "expiresAt": expires_at.isoformat()}


@router.get("/scanner/sessions/{session_id}")
def get_session(session_id: UUID, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    bearer = authorization.removeprefix("Bearer ") if authorization else None
    session = require_owner(db, session_id, bearer)
    if session.status != "ended" and datetime.now(timezone.utc) >= session.expires_at:
        session.status = "expired"
        db.commit()
    return session_view(session)


@router.post("/scanner/sessions/{session_id}/join")
def join_session(session_id: UUID, payload: ScannerJoinInput, request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    client_host = request.client.host if request.client else "unknown"
    scanner_rate_limiter.check(f"join:{session_id}:{client_host}", 10, 60)
    device_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    with db.begin():
        session = db.scalar(select(ScannerSession).where(ScannerSession.id == session_id).with_for_update())
        if not session:
            raise ApiError(404, "SCANNER_SESSION_NOT_FOUND", "Không tìm thấy phiên quét.")
        check_active(session)
        if session.status != "waiting_for_device":
            raise ApiError(409, "SCANNER_DEVICE_ALREADY_JOINED", "Phiên đã có thiết bị tham gia hoặc không còn chờ kết nối.")
        ticket = db.scalar(
            select(ScannerQrTicket)
            .where(
                ScannerQrTicket.session_id == session_id,
                ScannerQrTicket.nonce_hash == token_hash(payload.qrNonce),
                ScannerQrTicket.expires_at > now,
                ScannerQrTicket.consumed_at.is_(None),
                ScannerQrTicket.revoked_at.is_(None),
            )
            .with_for_update()
        )
        if not ticket:
            raise ApiError(410, "SCANNER_QR_EXPIRED", "QR đã hết hạn hoặc bị thay thế. Hãy quét QR mới nhất.")
        ticket.consumed_at = now
        session.status = "connected"
        session.device_name = payload.deviceName
        session.connected_at = now
        session.device_token_hash = token_hash(device_token)
    background_tasks.add_task(scanner_connections.broadcast, session_id, {"type": "session_status", "status": "connected"})
    return {"joined": True, "deviceToken": device_token, "message": "Thiết bị đã được xác thực trong phiên."}


@router.post("/scanner/sessions/{session_id}/scans")
def receive_scan(
    session_id: UUID,
    payload: ScannerEventInput,
    background_tasks: BackgroundTasks,
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    bearer = authorization.removeprefix("Bearer ") if authorization else None
    if payload.sessionId != session_id:
        raise ApiError(422, "SESSION_ID_MISMATCH", "sessionId trong payload không khớp với URL.")
    client_host = request.client.host if request.client else "unknown"
    scanner_rate_limiter.check(f"scan-ip:{session_id}:{client_host}", 300, 60)
    event, inserted = store_scan(db, session_id, payload, bearer)
    if inserted:
        background_tasks.add_task(scanner_connections.broadcast, session_id, event)
    return {"delivered": True, "duplicate": not inserted, "event": event}


@router.get("/scanner/sessions/{session_id}/scans")
def list_session_scans(
    session_id: UUID,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    bearer = authorization.removeprefix("Bearer ") if authorization else None
    require_owner(db, session_id, bearer)
    events = db.scalars(select(ScanEvent).where(ScanEvent.session_id == session_id).order_by(ScanEvent.scanned_at)).all()
    return [
        {
            "eventId": str(item.event_id), "sessionId": str(item.session_id), "barcode": item.barcode,
            "format": item.format, "scannedAt": item.scanned_at.isoformat(), "deviceId": item.device_id,
        }
        for item in events
    ]


@router.post("/scanner/sessions/{session_id}/close")
def close_session(session_id: UUID, background_tasks: BackgroundTasks, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    bearer = authorization.removeprefix("Bearer ") if authorization else None
    with db.begin():
        session = db.scalar(select(ScannerSession).where(ScannerSession.id == session_id).with_for_update())
        if not session:
            raise ApiError(404, "SCANNER_SESSION_NOT_FOUND", "Không tìm thấy phiên quét.")
        if not bearer or not hmac.compare_digest(session.owner_token_hash, token_hash(bearer)):
            raise ApiError(403, "SCANNER_OWNER_FORBIDDEN", "Không có quyền quản lý phiên quét này.")
        if session.status != "ended":
            session.status = "ended"
            session.closed_at = datetime.now(timezone.utc)
            session.device_token_hash = None
            db.query(ScannerQrTicket).filter(
                ScannerQrTicket.session_id == session_id,
                ScannerQrTicket.consumed_at.is_(None),
                ScannerQrTicket.revoked_at.is_(None),
            ).update({ScannerQrTicket.revoked_at: session.closed_at}, synchronize_session=False)
    background_tasks.add_task(scanner_connections.broadcast, session_id, {"type": "session_status", "status": "ended"})
    return session_view(session)


@router.post("/scanner/sessions/{session_id}/leave")
def leave_session(session_id: UUID, background_tasks: BackgroundTasks, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    bearer = authorization.removeprefix("Bearer ") if authorization else None
    with db.begin():
        session = db.scalar(select(ScannerSession).where(ScannerSession.id == session_id).with_for_update())
        if not session:
            raise ApiError(404, "SCANNER_SESSION_NOT_FOUND", "Không tìm thấy phiên quét.")
        if not bearer or not session.device_token_hash or not hmac.compare_digest(session.device_token_hash, token_hash(bearer)):
            raise ApiError(403, "SCANNER_DEVICE_FORBIDDEN", "Thiết bị chưa được xác thực trong phiên.")
        if session.status == "connected":
            session.status = "ended"
            session.closed_at = datetime.now(timezone.utc)
            session.device_token_hash = None
            db.query(ScannerQrTicket).filter(
                ScannerQrTicket.session_id == session_id,
                ScannerQrTicket.consumed_at.is_(None),
                ScannerQrTicket.revoked_at.is_(None),
            ).update({ScannerQrTicket.revoked_at: session.closed_at}, synchronize_session=False)
    background_tasks.add_task(scanner_connections.broadcast, session_id, {"type": "session_status", "status": "ended"})
    return session_view(session)


@router.websocket("/ws/scanner/sessions/{session_id}")
async def scanner_websocket(websocket: WebSocket, session_id: UUID):
    token = websocket_bearer(websocket, "scanner.v1")
    with SessionLocal() as db:
        session = db.get(ScannerSession, session_id)
        failure = websocket_auth_failure(session, token, "owner", datetime.now(timezone.utc))
    if failure:
        logger.warning("Scanner WebSocket rejected: role=owner session_id=%s reason=%s", session_id, failure, extra={"scanner_session_id": str(session_id), "scanner_role": "owner", "scanner_reason": failure})
        await websocket.close(code=4403, reason="Phiên scanner không được phép")
        return
    logger.info("Scanner WebSocket accepted: role=owner session_id=%s", session_id, extra={"scanner_session_id": str(session_id), "scanner_role": "owner"})
    await websocket.accept(subprotocol="scanner.v1")
    await scanner_connections.add(session_id, websocket)
    try:
        while True:
            if await websocket.receive_text() != "ping":
                await websocket.close(code=4400, reason="Thông điệp scanner không hợp lệ")
                break
            with SessionLocal() as db:
                session = db.get(ScannerSession, session_id)
                if not session or session.status in {"ended", "expired"}:
                    await websocket.close(code=4410, reason="Phiên scanner đã kết thúc")
                    break
                if datetime.now(timezone.utc) >= session.expires_at:
                    session.status = "expired"
                    db.commit()
                    await websocket.send_json({"type": "session_status", "status": "expired"})
                    await websocket.close(code=4410, reason="Phiên scanner đã hết hạn")
                    break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Scanner owner WebSocket failed", extra={"scanner_session_id": str(session_id), "scanner_role": "owner"})
    finally:
        await scanner_connections.remove(session_id, websocket)


@router.websocket("/ws/scanner/sessions/{session_id}/device")
async def scanner_device_websocket(websocket: WebSocket, session_id: UUID):
    token = websocket_bearer(websocket, "scanner.device.v1")
    with SessionLocal() as db:
        session = db.get(ScannerSession, session_id)
        failure = websocket_auth_failure(session, token, "device", datetime.now(timezone.utc))
    if failure:
        logger.warning("Scanner WebSocket rejected: role=device session_id=%s reason=%s", session_id, failure, extra={"scanner_session_id": str(session_id), "scanner_role": "device", "scanner_reason": failure})
        await websocket.close(code=4403, reason="Thiết bị scanner không được phép")
        return
    logger.info("Scanner WebSocket accepted: role=device session_id=%s", session_id, extra={"scanner_session_id": str(session_id), "scanner_role": "device"})
    await websocket.accept(subprotocol="scanner.device.v1")
    await scanner_connections.add(session_id, websocket)
    await scanner_connections.broadcast(session_id, {"type": "session_status", "status": "connected"})
    terminal_status: str | None = None
    try:
        while True:
            message = await websocket.receive_text()
            if message != "ping":
                request = None
                try:
                    request = json.loads(message)
                    if not isinstance(request, dict) or request.get("type") != "scan" or not isinstance(request.get("event"), dict):
                        raise ApiError(422, "SCANNER_MESSAGE_INVALID", "Thông điệp WebSocket không hợp lệ.")
                    payload = ScannerEventInput.model_validate(request["event"])
                    scanner_rate_limiter.check(f"scan-ip:{session_id}:{websocket.client.host if websocket.client else 'unknown'}", 300, 60)
                    with SessionLocal() as db:
                        event, inserted = store_scan(db, session_id, payload, token)
                    await websocket.send_json({"type": "scan_ack", "eventId": event["eventId"], "delivered": True, "duplicate": not inserted})
                    if inserted:
                        await scanner_connections.broadcast(session_id, event)
                except (json.JSONDecodeError, ValidationError, ApiError) as error:
                    if isinstance(error, ApiError):
                        status, code, detail = error.status_code, error.code, error.message
                    elif isinstance(error, ValidationError):
                        status, code, detail = 422, "SCANNER_PAYLOAD_INVALID", "Dữ liệu barcode không đúng định dạng."
                    else:
                        status, code, detail = 422, "SCANNER_MESSAGE_INVALID", "Thông điệp WebSocket không hợp lệ."
                    event_id = None
                    if isinstance(request, dict) and isinstance(request.get("event"), dict):
                        event_id = request["event"].get("eventId")
                    await websocket.send_json({"type": "scan_ack", "eventId": event_id, "error": detail, "status": status, "code": code})
                    if status == 403 or status == 410:
                        terminal_status = "ended" if status == 403 else "expired"
                        await websocket.close(code=4410, reason="Phiên scanner không còn hiệu lực")
                        break
                    continue
            with SessionLocal() as db:
                session = db.get(ScannerSession, session_id)
                if not session or session.status in {"ended", "expired"}:
                    terminal_status = session.status if session else "ended"
                elif datetime.now(timezone.utc) >= session.expires_at:
                    session.status = "expired"
                    db.commit()
                    terminal_status = "expired"
                elif not session.device_token_hash or not hmac.compare_digest(session.device_token_hash, token_hash(token)):
                    terminal_status = "ended"
            if terminal_status:
                await websocket.send_json({"type": "session_status", "status": terminal_status})
                if terminal_status == "expired":
                    await scanner_connections.broadcast(session_id, {"type": "session_status", "status": "expired"})
                await websocket.close(code=4410, reason="Phiên scanner đã kết thúc")
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Scanner device WebSocket failed", extra={"scanner_session_id": str(session_id), "scanner_role": "device"})
    finally:
        await scanner_connections.remove(session_id, websocket)
        if terminal_status is None:
            with SessionLocal() as db:
                session = db.get(ScannerSession, session_id)
                device_is_still_active = bool(session and session.status == "connected")
            if device_is_still_active:
                await scanner_connections.broadcast(session_id, {"type": "session_status", "status": "device_disconnected"})
