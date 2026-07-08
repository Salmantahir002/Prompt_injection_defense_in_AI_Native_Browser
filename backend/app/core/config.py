from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "Prompt Injection Defense Browser Backend"
    APP_ENV: str = "development"
    API_V1_PREFIX: str = "/api/v1"

    # CORS configuration
    CORS_ALLOWED_ORIGINS: Union[str, List[str]] = "http://localhost:5173"

    @field_validator("CORS_ALLOWED_ORIGINS")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    # ML & Analysis parameters
    MODEL_DIR: str = "app/ml_models/prompt_injection_model"
    CLASSIFIER_THRESHOLD: float = 0.70
    DEFAULT_CHUNK_SIZE: int = 800
    DEFAULT_CHUNK_OVERLAP: int = 100

    # NVIDIA NIM configurations
    NVIDIA_NIM_API_KEY: str = "replace_with_your_key"
    NVIDIA_NIM_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    NVIDIA_NIM_MODEL: str = "replace_with_selected_model"
    NVIDIA_NIM_VERIFY_SSL: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore"
    )


# Instantiate settings
settings = Settings()
