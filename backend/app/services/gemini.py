from google import genai
from google.genai import types, errors
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.services.pydantic_schemas import BridgePathExtractionPayload

EXTRACTION_SYSTEM_PROMPT = """
You are BridgePath AI's specialized document extraction engine for NYS Public Assistance (SNAP LDSS-4826 and Common App LDSS-2921).
Analyze the uploaded document image or PDF page carefully.

Extraction Guidelines:
1. Identify the exact document type, e.g., "Paystub", "CUNY ID Card", "Lease Agreement", "Utility Bill", "Bank Statement",
   "Financial Aid Award Letter", "SSI/Social Security Award Letter", "Unemployment Insurance Benefit Letter",
   "Veterans Benefits Letter", "Medical Professional's Statement", "School Record/Transcript", "Vehicle Title or Registration".
2. Extract all visible applicant data matching the provided JSON schema.
3. Be precise with financial values: gross income before taxes, pay frequency, rent amount, and utility responsibilities.
4. Classify each income entry using the income_type enum (wages, self_employment, ssi, social_security, veterans_benefits,
   unemployment_insurance, workers_compensation, child_support_received, foster_care_maintenance, pension_retirement,
   educational_assistance, alimony, rental_roomer_boarder, other) based on what the document shows - do not leave it as
   free text guesswork.
5. Classify each resource/asset using the resource_type enum (checking, savings, retirement_account, stocks_bonds,
   life_insurance, burial_trust_or_fund, vehicle, real_estate_other_than_residence, lump_sum_payment, other). Only fill
   vehicle_year/vehicle_make_model when resource_type is vehicle.
6. hours_worked_per_month must be monthly hours (matching the state forms' own "Hours Worked Monthly" fields). If the
   document shows hours for a different period, scale it: weekly hours x 4.33, biweekly hours x 2.17, semi-monthly
   hours x 2. If monthly hours are shown directly, use that value as-is.
7. property_taxes_annual and homeowners_insurance_annual must be annual figures (e.g. a property tax bill's assessed
   amount, or an insurance policy/declarations page's annual premium). Do NOT infer or back-calculate an annual figure
   from a monthly mortgage escrow breakdown - if only a monthly escrow portion is visible, leave the field null and
   note it in issues_or_missing_info instead of guessing.
8. If a field is not present in the document, leave it as null or empty list. Do NOT invent, assume, or hallucinate values.
9. In 'issues_or_missing_info', report any quality or clarity problems (e.g., blurred text, truncated pay period, ambiguous landlord contact, missing page, expired ID).
"""

# Lazily constructed on first use (not at import time) so a missing/invalid
# GEMINI_API_KEY fails the first /extract request, not the entire app's startup.
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client()  # reads GEMINI_API_KEY from the environment
    return _client



_TRANSIENT_CODES = {429, 500, 502, 503, 504}


def _is_transient(exc: BaseException) -> bool:
    return isinstance(exc, errors.APIError) and getattr(exc, "code", None) in _TRANSIENT_CODES


@retry(
    retry=retry_if_exception(_is_transient),
    stop=stop_after_attempt(3),  # 1 initial attempt + 2 retries
    wait=wait_exponential(multiplier=0.5, max=4),
    reraise=True,
)
def _call_gemini(content_part: types.Part) -> str:
    response = _get_client().models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=[content_part],
        config=types.GenerateContentConfig(
            system_instruction=EXTRACTION_SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=BridgePathExtractionPayload,
            temperature=0.0,
        ),
    )

    if not response.text:
        raise ValueError("Empty response received from Gemini Vision API")

    return response.text


def extract_document_data(file_bytes: bytes, mime_type: str) -> BridgePathExtractionPayload:
    """
    Calls Gemini Vision API with in-memory bytes and a Pydantic structured output schema.
    Retries only on transient upstream errors (429/5xx); content/parsing failures are not retried.
    Returns a parsed BridgePathExtractionPayload instance or raises an exception.
    """
    content_part = types.Part.from_bytes(data=file_bytes, mime_type=mime_type)
    raw_text = _call_gemini(content_part)
    return BridgePathExtractionPayload.model_validate_json(raw_text)
