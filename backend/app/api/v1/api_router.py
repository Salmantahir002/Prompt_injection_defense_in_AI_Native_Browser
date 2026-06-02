from fastapi import APIRouter
from app.api.v1 import health_routes
from app.api.v1 import security_routes

api_router = APIRouter()

api_router.include_router(health_routes.router, tags=["health"])
api_router.include_router(security_routes.router, tags=["security"])
