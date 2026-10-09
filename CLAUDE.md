# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

BridgePath AI extracts structured applicant data (household members, income, shelter costs, resources) from
uploaded documents (paystubs, IDs, leases, utility bills, bank statements, benefit award letters, etc.) using
Gemini Vision, to pre-fill the NYS public assistance applications **LDSS-2921** (Common Application — PA/SNAP/
Medicaid/Child Care/Services) and **LDSS-4826** (SNAP-only). The repo is a `backend/` (FastAPI + Gemini) and
`frontend/` (Vite + React) split; the frontend is currently an unmodified Vite scaffold with no app logic yet.

## Commands

### Backend (`backend/`)

No virtualenv exists in the repo; dependencies are installed into the system/user Python environment.

```bash
pip install -r backend/requirements.txt    # from backend/
uvicorn app.main:app --reload              # run from backend/ — imports are rooted at app.*
```

Copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY` (get one at
https://aistudio.google.com/apikey) before running — `app/main.py` calls `load_dotenv()` before importing
anything that constructs a Gemini client.

There is no backend test suite or lint config yet. To sanity-check changes, use `TestClient` from
`fastapi.testclient` against `app.main.app` (see prior session transcripts for the pattern used to verify
`/api/extract`'s 400/413/502 paths without a live API key).

### Frontend (`frontend/`)

```bash
npm install
npm run dev       # vite dev server
npm run build      # vite build
npm run lint       # oxlint
npm run preview
```

## Architecture

### Backend request flow

`app/main.py` loads `.env`, builds the FastAPI app, and mounts routers under `/api` (e.g. `POST /api/extract`).
**Import order matters**: `load_dotenv()` must run before `app.routes.extract` is imported, because
`app.services.gemini` reads `GEMINI_API_KEY` when its client is constructed.

The extraction pipeline for a single uploaded file is:

```
app/routes/extract.py  →  app/services/gemini.py  →  app/services/pydantic_schemas.py
        ↓                                                      ↑
app/services/analytics.py (telemetry)              BridgePathExtractionPayload (Gemini structured output schema)
```

- **`app/routes/extract.py`** — validates MIME type (jpg/png/pdf only) and size (≤10MB) in-memory (never writes
  to disk), calls `gemini.extract_document_data`, logs one anonymous telemetry event, and returns
  `{documentType, fields, issues}`. Validation failures are 400/413; any Gemini/parsing failure is caught and
  turned into a generic 502 (`"Couldn't read this file, try again."`) — raw exception details are never leaked
  to the client or logged.
- **`app/services/gemini.py`** — exactly **one Gemini API call per uploaded document** (model
  `gemini-2.5-flash`, `response_schema=BridgePathExtractionPayload`, `temperature=0.0`). The `genai.Client()` is
  a lazily-constructed module-level singleton (`_get_client()`), not built at import time — this is deliberate:
  constructing it eagerly would make a missing/invalid API key crash the *entire app* at startup instead of
  just failing the first request. `tenacity` retries (max 3 attempts, exponential backoff) apply **only** to
  transient upstream errors (HTTP 429/500/502/503/504 via `errors.APIError.code`) — a malformed/unparseable
  response is never retried, since retrying can't fix a content problem and would just burn API quota.
- **`app/services/pydantic_schemas.py`** — `BridgePathExtractionPayload` is a *unified canonical schema*
  deliberately shaped as a superset across both LDSS-2921 and LDSS-4826, rather than mirroring either form's
  layout, so the frontend can ask fewer follow-up questions regardless of which program the applicant is
  pursuing. Field additions here are scoped to what's plausibly *printed on a real document* — attestation-only
  facts from the forms (e.g. strike status, teen parent status, trust transfers) are intentionally excluded,
  since no uploaded document could ever supply them and adding them would only inflate the prompt/schema with
  guaranteed-null fields.
- **`app/services/analytics.py`** — `log_anonymous_event(document_type, is_flagged)` is the *only* logging path
  for extraction events. This is a hard zero-PII boundary: never log or print field values, SSNs, addresses,
  financial amounts, filenames, or raw exception content anywhere in the extraction pipeline — only
  `document_type` and a boolean `is_flagged`.
- **`app/services/document_requirements.py`** — static reference data (not wired into any route) transcribed
  from the official LDSS-2921 instructions' documentation-requirements table (PUB-1301, pages 18–19), mapping
  eligibility factors (e.g. "Residence", "Earned Income") to acceptable proof documents and the
  `BridgePathExtractionPayload` fields they inform. Intended as the data source for a future feature that
  aggregates multiple `/extract` results into one applicant profile and suggests what to upload next for
  still-missing fields — that aggregation feature doesn't exist yet.
- **`app/templates/`** — reference inputs, not code: `1301_ins.pdf` / `4826A_ins.pdf` are the official
  instructions for LDSS-2921 / LDSS-4826 (source of truth for schema/eligibility-factor design); `2921_fillable.pdf`
  / `4826_fillable.pdf` are the blank fillable form PDFs, presumably the eventual target of `pdf_filler.py`.

### Unimplemented stubs

`app/routes/eligibility.py`, `app/routes/forms.py`, `app/routes/speak.py`, `app/services/cover_sheet.py`,
`app/services/elevenlabs.py`, `app/services/eligibility_rules.py`, and `app/services/pdf_filler.py` all exist as
empty 0-byte files — placeholders for future work (eligibility determination, form-filling, text-to-speech via
ElevenLabs, cover sheet generation). Don't assume any logic exists in them.

### Directory naming

The actual router folder on disk is `app/routes/` (not `app/routers/`, which doesn't exist) — some earlier
design notes in `app/bridgepath_extract_spec.md` reference the wrong folder name; trust the filesystem.
