from fastapi import APIRouter
from app.services.prompt_classifier_service import prompt_classifier

router = APIRouter()


@router.get("/health")
def get_health():
    """
    Health check endpoint returning application status and ML model availability status.
    """
    return {
        "status": "healthy",
        "version": "1.0.0",
        "model_loaded": prompt_classifier.model_loaded,
        "classifier_mode": prompt_classifier.classifier_mode,
    }
