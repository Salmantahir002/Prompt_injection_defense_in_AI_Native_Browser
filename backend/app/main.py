import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.api.v1.api_router import api_router

# Initialize structured logging before initializing the app
setup_logging()

app = FastAPI(
    title=settings.APP_NAME,
    description="Real-Time Prompt Injection Defense Browser Backend API",
    version="1.0.0",
    docs_url="/docs" if settings.APP_ENV == "development" else None,
    redoc_url="/redoc" if settings.APP_ENV == "development" else None,
)

# CORS middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the api router under prefix /api/v1
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


@app.on_event("startup")
async def startup_event():
    logging.info("Starting up PromptGuard Backend Application...")
    logging.info(f"API documentation available at {settings.API_V1_PREFIX}/docs")


@app.on_event("shutdown")
async def shutdown_event():
    logging.info("Shutting down PromptGuard Backend Application...")
