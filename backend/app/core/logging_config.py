import logging
import sys
from app.core.config import settings


def setup_logging() -> None:
    """
    Set up standard logging configuration for the FastAPI backend.
    Uses structured/clean console formatting.
    """
    log_level = logging.INFO
    if settings.APP_ENV == "development":
        log_level = logging.DEBUG

    # Logging handlers setup
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
    )
    handler.setFormatter(formatter)

    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # Remove existing handlers to avoid duplicates
    for h in root_logger.handlers[:]:
        root_logger.removeHandler(h)
        
    root_logger.addHandler(handler)

    # Configure third-party loggers to prevent noise
    logging.getLogger("uvicorn.error").setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").setLevel(logging.INFO)
    
    logging.info(f"Logging initialized with level: {logging.getLevelName(log_level)}")
