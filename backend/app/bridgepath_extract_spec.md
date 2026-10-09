# BridgePath AI — `/extract` Route Specification & Code Implementation

This document contains the complete technical specification, Gemini Vision extraction prompt, Pydantic schema architecture, and Python implementation for the `/extract` route of **BridgePath AI**.

---

## 1. System Overview & bbArchitecture Strategy

### Minimum Follow-Up & Schema Alignment Strategy
To minimize user follow-up questions during the public assistance application flow (LDSS-2921 and LDSS-4826), the extraction engine uses a **Unified Canonical Schema**. 

Rather than strictly mimicking the visual page layout of state forms or raw document types, the schema captures the **superset of domain entities** required across both applications (`household_members`, `incomes`, `shelter`, `assets`).

* **Zero-PII Storage Policy:** All processing occurs 100% in-memory. File bytes are never written to disk or persistent storage.
* **Anonymous Telemetry:** The `/extract` route logs only `document_type` and `is_flagged` status. No names, SSNs, address strings, or financial values are ever logged or printed.
* **Graceful Failure Handling:** If Gemini Vision fails or encounters corrupted inputs, a standardized, user-friendly error (`"Couldn't read this file, try again."`) is returned to trigger the frontend retry state.

---

## 2. Gemini Extraction Prompt

The following system prompt is supplied to Gemini Vision alongside the Pydantic schema (`BridgePathExtractionPayload`):

```text
You are BridgePath AI's specialized document extraction engine for NYS Public Assistance (SNAP LDSS-4826 and Common App LDSS-2921).
Analyze the uploaded document image or PDF page carefully.

Extraction Guidelines:
1. Identify the exact document type (e.g., "Paystub", "CUNY ID Card", "Lease Agreement", "Utility Bill", "Bank Statement", "Financial Aid Award Letter").
2. Extract all visible applicant data matching the provided JSON schema.
3. Be precise with financial values: gross income before taxes, pay frequency, rent amount, and utility responsibilities.
4. If a field is not present in the document, leave it as null or empty list. Do NOT invent, assume, or hallucinate values.
5. In 'issues_or_missing_info', report any quality or clarity problems (e.g., blurred text, truncated pay period, ambiguous landlord contact, missing page, expired ID).
```

---

## 3. Directory Layout & File Structure

```text
backend/
└── app/
    ├── routers/
    │   └── extract.py          # /api/extract FastAPI Route Handler
    └── services/
        ├── analytics.py        # Anonymous Telemetry Logger (Zero PII)
        ├── gemini.py           # Gemini 1.5 / 2.5 Flash Vision Client
        └── pydantic_schemas.py # Unified Canonical Extraction Payload Schema
```

---

## 4. Source Code Implementation

### A. `backend/app/services/pydantic_schemas.py`

```python
from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field


class Frequency(str, Enum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    SEMI_MONTHLY = "semi_monthly"


class UtilityType(str, Enum):
    HEATING_PRIMARY = "heating_primary"
    ELECTRIC_LIGHTING = "electric_lighting"
    COOKING_GAS = "cooking_gas"
    WATER_SEWER = "water_sewer"
    TRASH = "trash"


class Individual(BaseModel):
    first_name: Optional[str] = Field(None, description="First name")
    last_name: Optional[str] = Field(None, description="Last name")
    dob: Optional[str] = Field(None, description="Format: YYYY-MM-DD")
    ssn: Optional[str] = Field(None, description="Social Security Number if visible")
    is_applicant: Optional[bool] = Field(False)
    relationship_to_applicant: Optional[str] = Field(None, description="e.g., Spouse, Child, Self")
    is_student: Optional[bool] = Field(None, description="Enrolled in college or higher education")
    citizen_status: Optional[str] = Field(None, description="US Citizen, Qualified Alien, etc.")


class IncomeSource(BaseModel):
    individual_name: Optional[str] = Field(None, description="Whose income this is")
    employer_or_source_name: Optional[str] = Field(None, description="Name of employer or agency")
    gross_amount: Optional[float] = Field(None, description="Gross pay amount before deductions")
    frequency: Optional[Frequency] = Field(None)
    hours_worked_per_week: Optional[float] = Field(None)


class UtilityDetail(BaseModel):
    utility_type: UtilityType
    is_included_in_rent: Optional[bool] = Field(None)
    monthly_cost: Optional[float] = Field(None)


class ShelterCosts(BaseModel):
    rent_or_mortgage_amount: Optional[float] = Field(None)
    frequency: Optional[Frequency] = Field(Frequency.MONTHLY)
    landlord_name: Optional[str] = Field(None)
    landlord_phone: Optional[str] = Field(None)
    utilities: Optional[List[UtilityDetail]] = Field(default_factory=list)


class LiquidAsset(BaseModel):
    asset_type: Optional[str] = Field(None, description="Checking, Savings, Cash on hand")
    amount: Optional[float] = Field(None)


class BridgePathExtractionPayload(BaseModel):
    doc_type_detected: str = Field(
        ..., 
        description="Detected document type, e.g., CUNY ID, Paystub, Lease Agreement, Utility Bill, Bank Statement"
    )
    primary_address: Optional[str] = Field(None, description="Full residential address")
    mailing_address: Optional[str] = Field(None)
    household_members: Optional[List[Individual]] = Field(default_factory=list)
    incomes: Optional[List[IncomeSource]] = Field(default_factory=list)
    shelter: Optional[ShelterCosts] = Field(None)
    assets: Optional[List[LiquidAsset]] = Field(default_factory=list)
    issues_or_missing_info: Optional[List[str]] = Field(
        default_factory=list,
        description="List any required details that appear blurred, cut off, incomplete, or ambiguous."
    )
```

---

### B. `backend/app/services/analytics.py`

```python
import logging

logger = logging.getLogger("bridgepath.analytics")


def log_anonymous_event(document_type: str, is_flagged: bool) -> None:
    """
    Logs an anonymous processing event to telemetry.
    Strictly zero-PII: records ONLY the document_type and whether issues were flagged.
    """
    logger.info(
        "Telemetry Event logged | doc_type=%s | is_flagged=%s",
        document_type,
        is_flagged
    )
```

---

### C. `backend/app/services/gemini.py`

```python
from google import genai
from google.genai import types
from app.services.pydantic_schemas import BridgePathExtractionPayload

EXTRACTION_SYSTEM_PROMPT = """
You are BridgePath AI's specialized document extraction engine for NYS Public Assistance (SNAP LDSS-4826 and Common App LDSS-2921).
Analyze the uploaded document image or PDF page carefully.

Extraction Guidelines:
1. Identify the exact document type (e.g., "Paystub", "CUNY ID Card", "Lease Agreement", "Utility Bill", "Bank Statement", "Financial Aid Award Letter").
2. Extract all visible applicant data matching the provided JSON schema.
3. Be precise with financial values: gross income before taxes, pay frequency, rent amount, and utility responsibilities.
4. If a field is not present in the document, leave it as null or empty list. Do NOT invent, assume, or hallucinate values.
5. In 'issues_or_missing_info', report any quality or clarity problems (e.g., blurred text, truncated pay period, ambiguous landlord contact, missing page, expired ID).
"""


def extract_document_data(file_bytes: bytes, mime_type: str) -> BridgePathExtractionPayload:
    """
    Calls Gemini Vision API with in-memory bytes and Pydantic structured output schema.
    Returns parsed BridgePathExtractionPayload instance or raises an Exception.
    """
    client = genai.Client()

    # Pass bytes directly in-memory without saving to disk
    content_part = types.Part.from_bytes(
        data=file_bytes,
        mime_type=mime_type
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=[content_part, EXTRACTION_SYSTEM_PROMPT],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=BridgePathExtractionPayload,
            temperature=0.0
        )
    )

    if not response.text:
        raise ValueError("Empty response received from Gemini Vision API")

    return BridgePathExtractionPayload.model_validate_json(response.text)
```

---

### D. `backend/app/routers/extract.py`

```python
from fastapi import APIRouter, File, UploadFile, HTTPException, status
import logging
from app.services.gemini import extract_document_data
from app.services.analytics import log_anonymous_event

router = APIRouter(prefix="/extract", tags=["extract"])

ALLOWED_MIME_TYPES = {
    "image/jpeg": "JPG",
    "image/jpg": "JPG",
    "image/png": "PNG",
    "application/pdf": "PDF"
}

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB limit


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
    # 1. Validate MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file format. Please upload a JPG, PNG, or PDF file."
        )

    # 2. Read in-memory bytes & validate file size
    try:
        file_bytes = await file.read()
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Couldn't read this file, try again."
        )

    if len(file_bytes) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty."
        )

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size exceeds maximum allowed limit (10MB)."
        )

    # 3. Call Gemini Vision API
    try:
        extraction_result = extract_document_data(
            file_bytes=file_bytes,
            mime_type=file.content_type
        )
    except Exception:
        # Intentionally generic user error (Zero PII logged)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Couldn't read this file, try again."
        )

    # 4. Extract telemetry indicators and log anonymous event
    doc_type = extraction_result.doc_type_detected or "UNKNOWN"
    issues_list = extraction_result.issues_or_missing_info or []
    is_flagged = len(issues_list) > 0

    log_anonymous_event(document_type=doc_type, is_flagged=is_flagged)

    # 5. Format output response
    fields_dict = extraction_result.model_dump(
        exclude={"doc_type_detected", "issues_or_missing_info"}
    )

    return {
        "documentType": doc_type,
        "fields": fields_dict,
        "issues": issues_list
    }
```
