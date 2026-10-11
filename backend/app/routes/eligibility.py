import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status

from app.services.analytics import log_eligibility_event
from app.services.eligibility_rules import evaluate

router = APIRouter(prefix="/eligibility", tags=["eligibility"])
logger = logging.getLogger("bridgepath.eligibility")

NO_INFORMATION_DETAIL = "No information to check."
GENERIC_FAILURE_DETAIL = "Something went wrong, try again."


def _is_wrapped(node: Any) -> bool:
    """A leaf is {value, source} and nothing else."""
    return isinstance(node, dict) and set(node.keys()) == {"value", "source"}


def split_values_and_sources(node: Any) -> tuple[Any, Any]:
    """
    Splits the applicant tree into two parallel trees of the same shape: plain values and their
    sources. Bare (unwrapped) scalars are accepted and treated as user-provided.
    """
    if _is_wrapped(node):
        return node["value"], node["source"]
    if isinstance(node, dict):
        pairs = {k: split_values_and_sources(v) for k, v in node.items()}
        return {k: p[0] for k, p in pairs.items()}, {k: p[1] for k, p in pairs.items()}
    if isinstance(node, list):
        pairs = [split_values_and_sources(v) for v in node]
        return [p[0] for p in pairs], [p[1] for p in pairs]
    return node, "user"


def _has_any_value(node: Any) -> bool:
    if isinstance(node, dict):
        return any(_has_any_value(v) for v in node.values())
    if isinstance(node, list):
        return any(_has_any_value(v) for v in node)
    return node is not None and node != ""


@router.post("", status_code=status.HTTP_200_OK)
async def check_eligibility(request: Request):
    """
    Body: { applicant: { ...nested, each leaf {value, source} } }.
    Returns { results: [ {benefit, status, reason, estimatedAmount, missing} ] }.
    - Parses the body by hand so FastAPI's 422 handler never echoes the applicant's data back.
    - Never logs or prints the applicant; telemetry is benefit + status only.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_INFORMATION_DETAIL)

    applicant = body.get("applicant") if isinstance(body, dict) else None
    if not isinstance(applicant, dict) or not _has_any_value(split_values_and_sources(applicant)[0]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, NO_INFORMATION_DETAIL)

    try:
        values, sources = split_values_and_sources(applicant)
        results = evaluate(values, sources)
    except Exception:
        # Intentionally generic and detail-free (zero PII in logs or responses)
        logger.warning("Eligibility evaluation failed")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, GENERIC_FAILURE_DETAIL)

    for r in results:
        log_eligibility_event(benefit=r["benefit"], status=r["status"])

    return {"results": results}
