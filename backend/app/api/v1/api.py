from fastapi import APIRouter

from app.api.v1.endpoints import documents, resources, scanner

api_router = APIRouter()
api_router.include_router(resources.router)
api_router.include_router(documents.router)
api_router.include_router(scanner.router)
