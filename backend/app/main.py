from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.errors import ApiError
from app.db.session import SessionLocal

app = FastAPI(title=settings.app_name, version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)


@app.exception_handler(ApiError)
async def api_error_handler(_request: Request, error: ApiError):
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": error.message, "details": error.details}},
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, error: RequestValidationError):
    errors = [
        {"field": ".".join(str(part) for part in issue["loc"] if part != "body"), "message": issue["msg"]}
        for issue in error.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "VALIDATION_ERROR", "message": "Dữ liệu gửi lên không hợp lệ.", "details": errors}},
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request: Request, error: StarletteHTTPException):
    message = error.detail if isinstance(error.detail, str) else "Yêu cầu không thể thực hiện."
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": "HTTP_ERROR", "message": message, "details": None}},
        headers=error.headers,
    )


@app.get("/health")
def health():
    return {"status": "ok", "service": "smart-warehouse-api"}


@app.get("/health/ready")
def readiness():
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503,
            content={"error": {"code": "DATABASE_UNAVAILABLE", "message": "Không thể kết nối PostgreSQL.", "details": None}},
        )
    return {"status": "ready", "database": "connected"}


app.include_router(api_router, prefix="/api/v1")
