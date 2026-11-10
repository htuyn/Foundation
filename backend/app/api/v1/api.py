from fastapi import APIRouter

from app.api.v1.endpoints import auth, documents, resources, scanner

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(resources.router)
api_router.include_router(documents.router)
api_router.include_router(scanner.router)
