# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

BridgePath AI extracts structured applicant data (household members, income, shelter costs, resources) from
uploaded documents (paystubs, IDs, leases, utility bills, bank statements, benefit award letters, etc.) using
Gemini Vision, to pre-fill the NYS public assistance applications **LDSS-2921** (Common Application — PA/SNAP/
Medicaid/Child Care/Services) and **LDSS-4826** (SNAP-only). The repo is a `backend/` (FastAPI + Gemini) and
`frontend/` (Vite + React) split. The frontend now has a step-based intake flow (consent → document upload →
questions → results → forms) but only the first two steps are implemented; see "Frontend architecture" below.

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
  `gemini-3.5-flash-lite`, `response_schema=BridgePathExtractionPayload`, `temperature=0.0`). The `genai.Client()` is
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

### Frontend architecture

`frontend/src/App.jsx` is a tiny step machine (`useState("consent")`) that renders one screen per step:
`consent` → `ConsentScreen`, `upload` → `IntakeUpload`, then `questions`/`results`/`forms` are still unimplemented
placeholder `<p>`s. `main.jsx` wraps `<App />` in `BridgeProvider`.

- **`src/context/BridgeContext.jsx`** — the single global state store (React Context), created via
  `BridgeProvider`. Holds `applicant`, a nested object matching `BridgePathExtractionPayload`'s shape **by key
  name** (`primary_address`, `mailing_address`, `household_members[]`, `incomes[]`, `shelter`, `assets[]`,
  plus a frontend-only `extra: {}` bucket for fields with no backend-schema home yet, e.g. phone), plus
  `documents`, `questionQueue`, `currentQuestion`, `results`, `fixing`, and `forms`, all with setters and a
  `reset()`. This replaced an earlier flat, single-applicant `fields` shape — the nested shape was adopted
  specifically because the real LDSS-2921/4826 fillable PDFs have row-indexed repeating fields per household
  member/income source (confirmed via pypdf inspection of `app/templates/*.pdf`, e.g. `First Name1`/`First
  Name2`, income `Row1`/`Row2`), which a flat single-applicant model cannot represent.
- **`src/utils/mergeExtraction.js`** — `mergeExtraction(applicant, fields, documentType)` accumulates one
  document's extracted `fields` into `applicant` without overwriting earlier documents' answers. The
  applicant's own household-member record (`is_applicant: true`) is found-or-created and null-fields-only
  merged, since the applicant is the one person expected to reappear across multiple document types (ID,
  lease, paystub). Every other household member/income/asset is tagged with `_source_document_type` and
  appended; re-uploading that same document type (the "fixing" flow) drops only its own prior contributions
  before appending the new ones — no fuzzy name-matching is attempted across different document types, so two
  different documents mentioning the same non-applicant household member can currently produce two entries
  (left for human cleanup on a future review screen rather than guessed at automatically).
- **`src/screens/ConsentScreen.jsx`** — static consent/disclosure screen (data collected, Gemini used to read
  documents, voice answers processed by Google, nothing is submitted on the user's behalf). Gates the "Continue"
  button on a single checkbox; still has lorem-ipsum placeholder body copy.
- **`src/screens/intakeUpload.jsx`** — **currently broken, not yet updated for the `applicant` shape above.**
  It still destructures `fields`/`setFields` from `BridgeContext`, which no longer exist (`undefined`), and its
  upload handler still runs the old flat null-check merge loop instead of calling `mergeExtraction`; its
  `handleContinue` still reads `fields[name].value` for the old flat `QuestionBank` keys. This was a deliberate,
  scoped-down change (ship the data-model shape + merge utility in isolation for review before touching every
  consumer) — **do not assume this file works** until it's updated to: destructure `applicant`/`setApplicant`;
  call `setApplicant(prev => mergeExtraction(prev, response.fields, response.documentType))` in the upload
  handler; and give `handleContinue` at least a temporary stub (e.g. `setQuestionQueue([])`) until
  `QuestionBank.json` is migrated to the nested shape (see below). Checklist-rejection logic and `setDocuments`
  status tracking don't read `fields` and are unaffected.
- **`src/utils/documentScanner.js`** — `pickFile(usePhoneCamera)` opens a native file input (or camera capture
  on mobile via `input.capture = "environment"`) and client-side validates type (jpg/png/pdf) and size (≤10MB)
  before resolving — a duplicate of the backend's own validation in `extract.py`, done client-side for instant
  feedback.
- **`src/utils/api.js`** — `extract(file)` is the only backend call. **`USE_MOCK` is currently hardcoded to
  `true`**, so it returns a canned `{ documentType: "pay_stub", fields: {...}, issues: [] }` after an 800ms
  delay instead of calling the real API — the real `fetch(BASE_URL + "/extract", ...)` path (`BASE_URL` from
  `VITE_API_URL`, default `http://localhost:8000`) is written but dead until someone flips `USE_MOCK` to `false`.
  **Not yet updated**: the mock's `fields` is still the old flat shape (`fullName`, `monthlyIncome`, ...), which
  doesn't match `mergeExtraction`'s expected nested shape (`household_members[]`, `incomes[]`, ...) — needs
  updating to realistic nested mock documents before `intakeUpload.jsx` can be tested end-to-end again.
- **`src/data/QuestionBank.json`** — one entry per frontend field name (`question`, `explanation`, `example`,
  `input` type, and an `askIf` for conditional follow-ups), used to generate the follow-up questionnaire for
  whatever fields the uploaded documents didn't fill. **Still keyed to the old flat field names** — hasn't been
  migrated to reference the new nested `applicant` shape (e.g. via a `scope`/`path` pair per entry, resolved
  once per household member/income source). Low priority: only needed once the `questions` screen (still an
  unimplemented placeholder, see below) is actually built.

**Current known gap (actively being worked on, not yet fixed):** `BridgeContext.jsx` and `mergeExtraction.js`
were updated to the nested, per-household shape described above, but their consumers were not updated in the
same change (a deliberate scope decision to land the data-model change in isolation for review). Until
`intakeUpload.jsx` and `api.js`'s mock are updated per the notes above, the upload screen does not function.
Don't assume the frontend intake flow works end-to-end just because `BridgeContext.jsx` looks correct.

### Unimplemented stubs

`app/routes/eligibility.py`, `app/routes/forms.py`, `app/routes/speak.py`, `app/services/cover_sheet.py`,
`app/services/elevenlabs.py`, `app/services/eligibility_rules.py`, and `app/services/pdf_filler.py` all exist as
empty 0-byte files — placeholders for future work (eligibility determination, form-filling, text-to-speech via
ElevenLabs, cover sheet generation). Don't assume any logic exists in them.

### Directory naming

The actual router folder on disk is `app/routes/` (not `app/routers/`, which doesn't exist) — some earlier
design notes in `app/bridgepath_extract_spec.md` reference the wrong folder name; trust the filesystem.
