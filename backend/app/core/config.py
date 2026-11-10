from functools import lru_cache
import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    app_name: str = "Smart Warehouse API"
    app_env: str = "development"
    database_url: str | None = None
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "warehouse_db"
    postgres_user: str = "warehouse_user"
    postgres_password: str = ""
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
    cors_origin_regex: str | None = None
    scanner_session_ttl_seconds: int = 600
    scanner_qr_ttl_seconds: int = 60
    auth_secret_key: str = ""
    auth_access_ttl_seconds: int = 900
    auth_refresh_ttl_seconds: int = 604800
    auth_cookie_domain: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return URL.create(
            "postgresql+psycopg",
            username=self.postgres_user,
            password=self.postgres_password or None,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        ).render_as_string(hide_password=False)

    @property
    def signing_key(self) -> str:
        if self.auth_secret_key:
            if len(self.auth_secret_key.encode()) < 32:
                raise ValueError("AUTH_SECRET_KEY phải có ít nhất 32 byte entropy.")
            return self.auth_secret_key
        if self.app_env.lower() in {"production", "prod"}:
            raise ValueError("AUTH_SECRET_KEY bắt buộc phải được cấu hình trong production.")
        return _development_signing_key


_development_signing_key = secrets.token_urlsafe(48)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
