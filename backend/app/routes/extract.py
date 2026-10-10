import logging

from fastapi import APIRouter, File, UploadFile, HTTPException, status
from google.genai import errors as genai_errors
from pydantic import ValidationError

from app.services.gemini import extract_document_data
from app.services.analytics import log_anonymous_event

router = APIRouter(prefix="/extract", tags=["extract"])
logger = logging.getLogger("bridgepath.extract")

ALLOWED_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "application/pdf"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB limit

GENERIC_FAILURE_DETAIL = "Couldn't read this file, try again."


@router.post("", status_code=status.HTTP_200_OK)
async def extract_document(file: UploadFile = File(...)):
    """
    Extracts structured fields from a single uploaded document.
    - Reads into memory only. Never writes to disk.
    - Rejects files that are not JPG, PNG, or PDF.
    - Calls gemini.py with file bytes and type.
    - Logs an anonymous telemetry event (doc_type, is_flagged).
    - Returns { documentType, fields, issues }.
    - Never logs or prints file contents or extracted PII.
    """
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file format. Please upload a JPG, PNG, or PDF file.",
        )

    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds maximum allowed limit (10MB).",
        )

    try:
        extraction_result = extract_document_data(
            file_bytes=file_bytes,
            mime_type=file.content_type,
        )
    except (genai_errors.APIError, ValueError, ValidationError):
        # Intentionally generic user-facing error (Zero PII logged)
        logger.warning("Extraction failed for an uploaded document")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=GENERIC_FAILURE_DETAIL,
        )

    doc_type = extraction_result.doc_type_detected.value
    issues_list = extraction_result.issues_or_missing_info or []
    is_flagged = len(issues_list) > 0

    log_anonymous_event(document_type=doc_type, is_flagged=is_flagged)

    fields_dict = extraction_result.model_dump(
        exclude={"doc_type_detected", "issues_or_missing_info"}
    )

    return {
        "documentType": doc_type,
        "fields": fields_dict,
        "issues": issues_list,
    }
