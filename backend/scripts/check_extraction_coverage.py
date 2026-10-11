"""
Manual dev tool: feed one or more sample documents through the real Gemini
extraction pipeline and report which BridgePathExtractionPayload fields came
back populated vs. still null across the whole set.

Makes real Gemini API calls (costs quota/money) - not part of any automated
test suite. Requires GEMINI_API_KEY to be set (via backend/.env).

Usage (run from anywhere; paths can be relative to your shell):
    python backend/scripts/check_extraction_coverage.py license.jpg paystub.pdf utility_bill.pdf

Caveat: boolean fields with a non-None default (e.g. is_applicant, defaults to
False) always count as "populated" here, since False is indistinguishable
from "not extracted" - read those fields' actual values yourself in the
printed JSON rather than trusting the coverage checkmark for them.
"""

import argparse
import json
import mimetypes
import sys
import typing
from pathlib import Path

# Make `app` importable regardless of the caller's cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from pydantic import BaseModel

from app.services.document_requirements import DOCUMENT_REQUIREMENTS
from app.services.gemini import extract_document_data
from app.services.pydantic_schemas import BridgePathExtractionPayload

EXT_TO_MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf"}
SUPPORTED_MIMES = {"image/jpeg", "image/png", "application/pdf"}


def _unwrap_optional(ann):
    if typing.get_origin(ann) is typing.Union:
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return ann


def iter_leaf_paths(model_cls: type[BaseModel], prefix: str = ""):
    """Enumerate every leaf field path in a Pydantic model, e.g. 'shelter.rent_or_mortgage_amount'
    or 'household_members[].ssn' for list-of-model fields."""
    for name, finfo in model_cls.model_fields.items():
        ann = _unwrap_optional(finfo.annotation)
        origin = typing.get_origin(ann)
        full = f"{prefix}{name}"
        if origin is list:
            args = typing.get_args(ann)
            inner = _unwrap_optional(args[0]) if args else str
            if isinstance(inner, type) and issubclass(inner, BaseModel):
                yield from iter_leaf_paths(inner, prefix=f"{full}[].")
            else:
                yield f"{full}[]"
        elif isinstance(ann, type) and issubclass(ann, BaseModel):
            yield from iter_leaf_paths(ann, prefix=f"{full}.")
        else:
            yield full


def _values_at_path(data, tokens: list[str]):
    if not tokens:
        yield data
        return
    tok, rest = tokens[0], tokens[1:]
    if tok.endswith("[]"):
        items = data.get(tok[:-2]) if isinstance(data, dict) else None
        if isinstance(items, list):
            for item in items:
                yield from _values_at_path(item, rest)
    elif isinstance(data, dict) and tok in data:
        yield from _values_at_path(data[tok], rest)


def _is_nonempty(v) -> bool:
    if v is None:
        return False
    if isinstance(v, str):
        return v.strip() != ""
    if isinstance(v, (list, dict)):
        return len(v) > 0
    return True


def path_is_populated(doc_dicts: list[dict], path: str) -> bool:
    tokens = path.split(".")
    return any(_is_nonempty(v) for d in doc_dicts for v in _values_at_path(d, tokens))


def suggestions_for_path(path: str) -> list[str]:
    docs = []
    for req in DOCUMENT_REQUIREMENTS:
        for rf in req.related_fields:
            if rf.split("=")[0] == path:
                docs.extend(req.acceptable_documents)
                break
    seen = set()
    return [d for d in docs if not (d in seen or seen.add(d))]


def guess_mime(path: Path) -> str | None:
    mime, _ = mimetypes.guess_type(path.name)
    return mime or EXT_TO_MIME.get(path.suffix.lower())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="+", help="Paths to sample documents (jpg/png/pdf)")
    args = parser.parse_args()

    results: list[BridgePathExtractionPayload] = []
    for raw_path in args.files:
        path = Path(raw_path)
        mime = guess_mime(path)
        print(f"\n=== {path.name} ===")
        if mime not in SUPPORTED_MIMES:
            print(f"  [skip] unsupported or undetected MIME type: {mime}")
            continue
        try:
            result = extract_document_data(file_bytes=path.read_bytes(), mime_type=mime)
        except Exception as exc:
            print(f"  [FAILED] {type(exc).__name__}: {exc}")
            continue
        print(f"  detected doc type: {result.doc_type_detected}")
        if result.issues_or_missing_info:
            print(f"  issues flagged: {result.issues_or_missing_info}")
        print(json.dumps(result.model_dump(mode="json"), indent=2))
        results.append(result)

    if not results:
        print("\nNo documents were successfully extracted; nothing to score.")
        return

    doc_dicts = [r.model_dump(mode="json") for r in results]
    all_paths = list(iter_leaf_paths(BridgePathExtractionPayload))
    populated = [p for p in all_paths if path_is_populated(doc_dicts, p)]
    missing = [p for p in all_paths if p not in populated]

    print(f"\n=== Coverage: {len(populated)}/{len(all_paths)} schema fields populated across {len(results)} document(s) ===")

    print("\nPopulated:")
    for p in populated:
        print(f"  [x] {p}")

    print("\nStill missing:")
    for p in missing:
        suggestions = suggestions_for_path(p)
        if suggestions:
            shown = ", ".join(suggestions[:4]) + ("..." if len(suggestions) > 4 else "")
            print(f"  [ ] {p}  ->  try uploading: {shown}")
        else:
            print(f"  [ ] {p}")


if __name__ == "__main__":
    main()
