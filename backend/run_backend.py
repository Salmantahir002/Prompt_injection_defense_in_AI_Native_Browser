import uvicorn
from app.core.config import settings


def main():
    # Detect reload setting based on APP_ENV
    reload_enabled = settings.APP_ENV == "development"
    
    print(f"Launching {settings.APP_NAME} on http://127.0.0.1:8000")
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=reload_enabled,
        log_level="info"
    )


if __name__ == "__main__":
    main()
