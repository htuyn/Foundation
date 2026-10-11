from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.v1.endpoints import scanner
from app.main import app


class FakeSessionDb:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def get(self, _model, _session_id):
        return self.session


def fake_session(*, status="connected", expires_at=None, owner_token="owner-secret", device_token="device-secret"):
    from app.api.v1.endpoints.scanner import token_hash

    return SimpleNamespace(
        status=status,
        expires_at=expires_at or datetime.now(timezone.utc) + timedelta(minutes=2),
        owner_token_hash=token_hash(owner_token),
        device_token_hash=token_hash(device_token),
    )


def test_websocket_bearer_uses_asgi_subprotocol_list_without_logging_or_parsing_token_header():
    websocket = SimpleNamespace(
        scope={"subprotocols": ["scanner.v1", "owner-secret"]},
        headers={"sec-websocket-protocol": "scanner.v1"},
    )

    assert scanner.websocket_bearer(websocket, "scanner.v1") == "owner-secret"
    assert scanner.websocket_bearer(websocket, "scanner.device.v1") is None


@pytest.mark.parametrize(
    ("session", "token", "role", "expected"),
    [
        (None, "owner-secret", "owner", "session_not_found"),
        (fake_session(), "wrong", "owner", "invalid_token"),
        (fake_session(), "device-secret", "owner", "invalid_token"),
        (fake_session(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)), "owner-secret", "owner", "session_expired"),
        (fake_session(status="ended"), "owner-secret", "owner", "session_closed"),
        (fake_session(status="waiting_for_device"), "device-secret", "device", "device_not_joined"),
        (fake_session(), "wrong", "device", "invalid_token"),
    ],
)
def test_websocket_auth_failure_distinguishes_session_and_token_states(session, token, role, expected):
    reason = scanner.websocket_auth_failure(session, token, role, datetime.now(timezone.utc))

    assert reason == expected


def test_owner_websocket_route_uses_api_prefix_and_accepts_owner_token(monkeypatch):
    session_id = uuid4()
    monkeypatch.setattr(scanner, "SessionLocal", lambda: FakeSessionDb(fake_session(status="waiting_for_device")))
    client = TestClient(app)

    with client.websocket_connect(
        f"/api/v1/ws/scanner/sessions/{session_id}",
        subprotocols=["scanner.v1", "owner-secret"],
    ):
        pass


def test_device_websocket_route_accepts_only_paired_device_token(monkeypatch):
    session_id = uuid4()
    monkeypatch.setattr(scanner, "SessionLocal", lambda: FakeSessionDb(fake_session(status="connected")))
    client = TestClient(app)

    with client.websocket_connect(
        f"/api/v1/ws/scanner/sessions/{session_id}/device",
        subprotocols=["scanner.device.v1", "device-secret"],
    ) as websocket:
        assert websocket.receive_json() == {"type": "session_status", "status": "connected"}


@pytest.mark.parametrize(
    ("session", "protocols", "expected_reason"),
    [
        (None, ["scanner.v1", "owner-secret"], "session_not_found"),
        (fake_session(), ["scanner.v1", "wrong"], "invalid_token"),
        (fake_session(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)), ["scanner.v1", "owner-secret"], "session_expired"),
    ],
)
def test_owner_websocket_route_rejects_invalid_or_expired_session(monkeypatch, caplog, session, protocols, expected_reason):
    session_id = uuid4()
    monkeypatch.setattr(scanner, "SessionLocal", lambda: FakeSessionDb(session))
    client = TestClient(app)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/api/v1/ws/scanner/sessions/{session_id}",
            subprotocols=protocols,
        ):
            pass

    assert expected_reason in caplog.text
    assert "owner-secret" not in caplog.text


def test_device_websocket_route_rejects_invalid_token_without_logging_it(monkeypatch, caplog):
    session_id = uuid4()
    monkeypatch.setattr(scanner, "SessionLocal", lambda: FakeSessionDb(fake_session(status="connected")))
    client = TestClient(app)

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/api/v1/ws/scanner/sessions/{session_id}/device",
            subprotocols=["scanner.device.v1", "wrong-device-token"],
        ):
            pass

    assert "role=device" in caplog.text
    assert "invalid_token" in caplog.text
    assert "wrong-device-token" not in caplog.text
