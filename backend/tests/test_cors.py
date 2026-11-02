import pytest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import app


PREVIEW_ORIGIN_REGEX = r"^https://foundation-[a-z0-9-]+-kthp-s-projects\.vercel\.app$"
ALLOWED_ORIGINS = (
    "https://foundation-wheat-tau.vercel.app",
    "https://foundation-43bbt4n4a-kthp-s-projects.vercel.app",
    "https://foundation-ovvxcruzv-kthp-s-projects.vercel.app",
)
DENIED_ORIGINS = (
    "https://another-project-kthp-s-projects.vercel.app",
    "https://foundation-43bbt4n4a-kthp-s-projects.vercel.app.evil.com",
    "http://foundation-43bbt4n4a-kthp-s-projects.vercel.app",
)


@pytest.fixture
def configured_app_cors(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", ALLOWED_ORIGINS[0])
    monkeypatch.setenv("CORS_ORIGIN_REGEX", PREVIEW_ORIGIN_REGEX)
    settings = Settings(_env_file=None)
    cors_middleware = [item for item in app.user_middleware if item.cls is CORSMiddleware]
    assert len(cors_middleware) == 1

    middleware = cors_middleware[0]
    previous_kwargs = middleware.kwargs.copy()
    previous_stack = app.middleware_stack
    middleware.kwargs.update(
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex or None,
    )
    app.middleware_stack = None

    try:
        yield settings
    finally:
        middleware.kwargs.clear()
        middleware.kwargs.update(previous_kwargs)
        app.middleware_stack = previous_stack


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_cors_middleware_allows_production_and_foundation_previews(configured_app_cors, origin):
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": origin})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", DENIED_ORIGINS)
def test_cors_middleware_rejects_untrusted_vercel_origins(configured_app_cors, origin):
    with TestClient(app) as client:
        response = client.get("/health", headers={"Origin": origin})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_bootstrap_preflight_allows_origin_methods_and_headers(configured_app_cors):
    assert configured_app_cors.cors_origin_regex == PREVIEW_ORIGIN_REGEX
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/bootstrap",
            headers={
                "Origin": ALLOWED_ORIGINS[1],
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type,idempotency-key",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGINS[1]
    assert "GET" in response.headers["access-control-allow-methods"]
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert {"authorization", "content-type", "idempotency-key"}.issubset(set(allowed_headers.split(", ")))


def test_bootstrap_preflight_rejects_untrusted_origin(configured_app_cors):
    with TestClient(app) as client:
        response = client.options(
            "/api/v1/bootstrap",
            headers={
                "Origin": DENIED_ORIGINS[0],
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_environment_defaults_preserve_local_origins(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    monkeypatch.delenv("CORS_ORIGIN_REGEX", raising=False)
    settings = Settings(_env_file=None)

    assert settings.cors_origin_list == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
    ]
    assert settings.cors_origin_regex is None
