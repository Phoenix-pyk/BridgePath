import logging

logger = logging.getLogger("bridgepath.analytics")


def log_anonymous_event(document_type: str, is_flagged: bool) -> None:
    """
    Zero-PII telemetry: logs ONLY document_type and is_flagged.
    Never pass field values, filenames, or exception details here.
    """
    logger.info(
        "Telemetry Event logged | doc_type=%s | is_flagged=%s",
        document_type,
        is_flagged,
    )
