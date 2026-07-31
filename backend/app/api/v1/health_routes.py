import platform
import sys

import fastapi
import uvicorn
from fastapi import APIRouter

from app.services.prompt_classifier_service import prompt_classifier

router = APIRouter()


@router.get("/health")
def get_health():
    """
    Health check endpoint returning application status, ML model availability
    status, and the backend runtime versions (surfaced in the Electron
    DevTools console banner alongside the Electron/Chromium versions).
    """
    return {
        "status": "healthy",
        "version": "1.0.0",
        "model_loaded": prompt_classifier.model_loaded,
        "classifier_mode": prompt_classifier.classifier_mode,
        "runtime": {
            "python": platform.python_version(),
            "python_implementation": f"{platform.python_implementation()} ({sys.version.split()[0]})",
            "fastapi": fastapi.__version__,
            "uvicorn": uvicorn.__version__,
            "platform": platform.platform(),
        },
    }
