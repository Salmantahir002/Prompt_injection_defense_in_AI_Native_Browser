from fastapi import APIRouter
from app.api.v1 import health_routes
from app.api.v1 import security_routes
from app.api.v1 import llm_routes
from app.api.v1 import crawler_routes

api_router = APIRouter()

api_router.include_router(health_routes.router, tags=["health"])
api_router.include_router(security_routes.router, tags=["security"])
api_router.include_router(llm_routes.router, tags=["llm"])
api_router.include_router(crawler_routes.router, tags=["crawler"])
