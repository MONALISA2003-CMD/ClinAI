"""ClinAI intelligence service boundary.

This service deliberately keeps clinical generation behind an explicit review gate.
A production deployment can connect an approved Vertex/Gemini model here after
privacy, regional data handling, model evaluation and clinical governance review.
"""
from fastapi import FastAPI
from pydantic import BaseModel, Field
from typing import Any

SUPPORTED_LANGUAGES = {"English", "Kiswahili", "Luganda", "Runyankore"}

app = FastAPI(title="ClinAI AI Service", version="0.3.0")

class Context(BaseModel):
    patient_id: str | None = None
    purpose: str = Field(min_length=1)
    question: str = Field(min_length=1)
    clinical_context: dict[str, Any] = Field(default_factory=dict)
    language: str = "English"

@app.get("/health")
def health():
    return {"ok": True, "service": "clinai-ai", "mode": "review-gated"}

@app.post("/v1/assist")
def assist(c: Context):
    language = c.language if c.language in SUPPORTED_LANGUAGES else "English"
    return {
        "status": "review_required",
        "purpose": c.purpose,
        "answer": None,
        "safety": [
            "Do not use as autonomous diagnosis or treatment",
            "Clinician review required",
            "Production model access requires approved privacy and clinical governance controls",
        ],
        "provenance": [],
        "model": "clinai-ai-service-boundary",
        "model_version": "0.3.0",
        "response_language": language,
        "language_safety": "Translation and clinical meaning require verification; this boundary never performs autonomous clinical decisions.",
        "prompt_version": "v1",
    }
