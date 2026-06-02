"""
LLM Routes
==========
POST /api/v1/llm/chat — forwards approved prompts to the NVIDIA NIM API.
This endpoint enforces the security-first flow: prompts must have been checked
by the security pipeline BEFORE reaching this endpoint.
"""

from fastapi import APIRouter, HTTPException

from app.schemas.llm_schemas import LlmChatRequest, LlmChatResponse, LlmUsage
from app.services.llm_nvidia_nim_service import llm_nvidia_nim_service
from app.services.prompt_classifier_service import prompt_classifier

router = APIRouter()


@router.post("/llm/chat", response_model=LlmChatResponse)
async def llm_chat(request: LlmChatRequest):
    """
    Forward a security-approved prompt to the LLM.

    The caller is responsible for checking the prompt via /security/check-prompt first.
    This endpoint performs a final safety gate: if the prompt is detected as malicious,
    it will be rejected and never forwarded to the LLM.
    """
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty.")

    # Final safety gate — verify the prompt is not malicious
    classification = prompt_classifier.classify(request.prompt)
    if classification["is_malicious"]:
        raise HTTPException(
            status_code=403,
            detail="Prompt blocked by security pipeline. Malicious content detected — not forwarding to LLM.",
        )

    # Forward to LLM
    result = await llm_nvidia_nim_service.chat(request.prompt)

    return LlmChatResponse(
        response=result["response"],
        model=result["model"],
        usage=LlmUsage(**result["usage"]),
    )
