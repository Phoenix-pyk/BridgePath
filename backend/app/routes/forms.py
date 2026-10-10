import base64
import logging

from fastapi import APIRouter, HTTPException, Request, status

from app.routes.eligibility import _has_any_value, split_values_and_sources
from app.services.analytics import log_forms_event
from app.services.pdf_filler import fill_form

router = APIRouter(prefix="/forms", tags=["forms"])
logger = logging.getLogger("bridgepath.forms")

KNOWN_BENEFITS = ["SNAP"]  # MVP; add Fair Fares / CUNY Emergency Grant later (template, rules, questions, filling logic)

NO_BENEFITS_DETAIL = "No benefits to create forms for."
UNKNOWN_BENEFIT_DETAIL = "Unknown benefit."
NO_INFORMATION_DETAIL = "No information to fill the forms."
GENERIC_FAILURE_DETAIL = "Couldn't create your forms, try again."


@router.post("", status_code=status.HTTP_200_OK)
async def create_forms(request: Request):
    """
    Body: { applicant: { ...nested, each leaf {value, source} }, benefits: ["SNAP", ...] }.
    Returns { forms: [ {name, pdf (base64)} ] }, one filled form per benefit.
    - Parses the body by hand so FastAPI's 422 handler never echoes the applicant's data back.
    - PDFs live in memory only; nothing is saved, printed or logged. Telemetry is the benefit name only.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_BENEFITS_DETAIL)
    if not isinstance(body, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_BENEFITS_DETAIL)

    benefits = body.get("benefits")
    if not isinstance(benefits, list) or not benefits:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_BENEFITS_DETAIL)
    if any(not isinstance(b, str) or b not in KNOWN_BENEFITS for b in benefits):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, UNKNOWN_BENEFIT_DETAIL)

    applicant = body.get("applicant")
    if not isinstance(applicant, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_INFORMATION_DETAIL)
    values, _sources = split_values_and_sources(applicant)
    if not _has_any_value(values):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_INFORMATION_DETAIL)

    forms = []
    try:
        for benefit in dict.fromkeys(benefits):  # de-duplicated, order kept
            name, pdf_bytes = fill_form(benefit, values)
            forms.append({"name": name, "pdf": base64.b64encode(pdf_bytes).decode("ascii")})
    except Exception:
        # Intentionally generic and detail-free (zero PII in logs or responses)
        logger.warning("Form filling failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, GENERIC_FAILURE_DETAIL)

    for benefit in dict.fromkeys(benefits):
        log_forms_event(benefit=benefit)

    return {"forms": forms}
