from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.auth import hash_password
from app.core.config import settings
from app.main import app
from app.models import AuditLog, AuthSession, Category, User


def test_password_length_allows_six_characters_and_rejects_fewer():
    assert hash_password("admin123")
    with pytest.raises(ValueError):
        hash_password("12345")


def make_client(monkeypatch, role="Quản trị viên", active=True):
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (User, AuthSession, AuditLog, Category):
        model.__table__.create(engine)
    test_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    user_id = uuid4()
    with test_session.begin() as db:
        db.add(User(id=user_id, name="Người kiểm thử", email="user@example.com", role=role, active=active, password_hash=hash_password("correct horse battery")))

    def override_get_db():
        with test_session() as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    monkeypatch.setattr(settings, "auth_secret_key", "test-auth-signing-key-that-is-long-enough")
    monkeypatch.setattr(settings, "app_env", "test")
    monkeypatch.setitem(app.dependency_overrides, get_db, override_get_db)
    return TestClient(app), user_id, engine


def test_login_requires_valid_password_and_returns_no_password_hash(monkeypatch):
    client, _user_id, engine = make_client(monkeypatch)
    try:
        invalid = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "wrong password"})
        assert invalid.status_code == 401
        response = client.post("/api/v1/auth/login", json={"email": "USER@example.com", "password": "correct horse battery"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["user"]["email"] == "user@example.com"
        assert "password_hash" not in payload["user"]
        assert response.cookies.get("warehouse_refresh")
        assert response.cookies.get("warehouse_csrf") == payload["csrfToken"]
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_access_token_required_for_bootstrap_and_user_id_header_is_not_trusted(monkeypatch):
    client, user_id, engine = make_client(monkeypatch)
    try:
        assert client.get("/api/v1/bootstrap").status_code == 401
        forged = client.get("/api/v1/categories", headers={"X-User-Id": str(user_id)})
        assert forged.status_code == 401
        login = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "correct horse battery"}).json()
        authorized = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {login['accessToken']}"})
        assert authorized.status_code == 200
        assert authorized.json()["id"] == str(user_id)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_logout_revokes_refresh_and_access_session(monkeypatch):
    client, _user_id, engine = make_client(monkeypatch)
    try:
        login = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "correct horse battery"}).json()
        csrf = client.cookies.get("warehouse_csrf")
        logout = client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf})
        assert logout.status_code == 204
        me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {login['accessToken']}"})
        assert me.status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_csrf_is_required_to_rotate_refresh_token(monkeypatch):
    client, _user_id, engine = make_client(monkeypatch)
    try:
        client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "correct horse battery"})
        response = client.post("/api/v1/auth/refresh")
        assert response.status_code == 403
        csrf = client.cookies.get("warehouse_csrf")
        assert client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf}).status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_viewer_cannot_write_even_with_valid_access_token(monkeypatch):
    client, _user_id, engine = make_client(monkeypatch, role="Chỉ xem")
    try:
        login = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "correct horse battery"}).json()
        response = client.post("/api/v1/categories", json={"name": "Không được phép"}, headers={"Authorization": f"Bearer {login['accessToken']}"})
        assert response.status_code == 403
        assert client.get("/api/v1/users", headers={"Authorization": f"Bearer {login['accessToken']}"}).status_code == 403
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_admin_password_reset_revokes_active_access_session(monkeypatch):
    client, user_id, engine = make_client(monkeypatch)
    try:
        login = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "correct horse battery"}).json()
        reset = client.put(
            f"/api/v1/auth/users/{user_id}/password",
            json={"password": "replacement password 2026"},
            headers={"Authorization": f"Bearer {login['accessToken']}"},
        )
        assert reset.status_code == 204
        assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {login['accessToken']}"}).status_code == 401
        replacement_login = client.post("/api/v1/auth/login", json={"email": "user@example.com", "password": "replacement password 2026"})
        assert replacement_login.status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
