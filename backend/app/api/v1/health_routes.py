import os
from fastapi import APIRouter
from app.core.config import settings

router = APIRouter()


@router.get("/health")
def get_health():
    """
    Health check endpoint returning application status and ML model availability status.
    """
    model_loaded = False
    
    # Check if the primary classifier model file exists in the configured model directory
    model_file_path = os.path.join(settings.MODEL_DIR, "prompt_injection_pipeline.joblib")
    if os.path.exists(model_file_path):
        model_loaded = True
        
    return {
        "status": "healthy",
        "version": "1.0.0",
        "model_loaded": model_loaded
    }
