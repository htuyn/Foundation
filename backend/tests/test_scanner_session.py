from datetime import datetime
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.api.v1.endpoints.scanner import token_hash
from app.main import app
from app.models import ScannerSession


def test_create_scanner_session_returns_frontend_contract_and_persists_record(monkeypatch):
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    ScannerSession.__table__.create(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        with test_session() as db:
            yield db

    monkeypatch.setitem(app.dependency_overrides, get_db, override_get_db)

    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post("/api/v1/scanner/sessions")

        assert response.status_code == 201
        payload = response.json()
        session_id = UUID(payload["sessionId"])
        owner_token = payload["ownerToken"]
        created_at = datetime.fromisoformat(payload["createdAt"])
        expires_at = datetime.fromisoformat(payload["expiresAt"])

        assert payload["mode"] == "api"
        assert payload["status"] == "waiting_for_device"
        assert isinstance(owner_token, str) and len(owner_token) >= 32
        assert created_at.tzinfo is not None
        assert expires_at > created_at

        with test_session() as db:
            stored = db.scalar(select(ScannerSession).where(ScannerSession.id == session_id))
            assert stored is not None
            assert stored.status == payload["status"]
            assert stored.owner_token_hash == token_hash(owner_token)
    finally:
        engine.dispose()
