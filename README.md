# BridgePath

BridgePath AI helps people apply for New York State public assistance. An applicant uploads documents they
already have (pay stubs, IDs, leases, utility bills, bank statements, benefit letters, etc.), Gemini Vision reads
them, and the extracted data is used to pre-fill the state application forms:

- **LDSS-2921**: Common Application (Public Assistance / SNAP / Medicaid / Child Care / Services)
- **LDSS-4826**: SNAP-only application

Fewer blanks on the forms means fewer follow-up questions for the applicant.

## Status

| Area | State |
| --- | --- |
| `POST /api/extract`: Gemini document extraction | ✅ Working |
| Consent screen | ✅ Working (body copy is still placeholder text) |
| Document upload screen | ✅ Working end-to-end against the real backend |
| Follow-up questions screen | ⏳ Not started (placeholder) |
| Eligibility results screen | ⏳ Not started (placeholder) |
| Form filling / PDF generation | ⏳ Not started (placeholder) |
| Text-to-speech (ElevenLabs) | ⏳ Not started |

## Repository layout

```
backend/    FastAPI + Gemini extraction API
frontend/   Vite + React intake app
```

## Getting started

### Backend

Requires Python 3 and a Gemini API key from https://aistudio.google.com/apikey.

```bash
cd backend
python -m venv venv && source venv/bin/activate   # optional, venv/ is gitignored
pip install -r requirements.txt
echo "GEMINI_API_KEY=your-key-here" > .env
uvicorn app.main:app --reload                      # http://localhost:8000
```

Run `uvicorn` from inside `backend/`, because imports are rooted at `app.*`.

### Frontend

```bash
cd frontend
npm install
npm run dev       # Vite dev server
npm run build     # production build
npm run lint      # oxlint
```

The frontend calls the backend at `VITE_API_URL` (default `http://localhost:8000`). To work on the UI without
the backend or an API key, set `USE_MOCK = true` in [frontend/src/utils/api.js](frontend/src/utils/api.js),
which returns canned data instead of calling the API.

## How it works

### Backend

`POST /api/extract` takes one uploaded file (JPG, PNG or PDF, up to 10 MB) and returns:

```json
{ "documentType": "pay_stub", "fields": { ... }, "issues": [ ... ] }
```

- **[routes/extract.py](backend/app/routes/extract.py)**: validates type and size in memory (files are never
  written to disk) and returns 400/413 for bad input. Any extraction failure becomes a generic 502, and raw
  error details are never sent to the client.
- **[services/gemini.py](backend/app/services/gemini.py)**: makes exactly one Gemini call per document, using
  structured output with `temperature=0`. Only transient upstream errors (429/5xx) are retried, up to 3 times
  with backoff.
- **[services/pydantic_schemas.py](backend/app/services/pydantic_schemas.py)**: `BridgePathExtractionPayload`
  is the extraction schema. It covers both forms (household members, incomes, shelter costs, assets) and
  includes only facts that could plausibly be printed on a real document. `doc_type_detected` is a
  `DocumentType` enum (ID, pay stub, lease, utility bill, bank statement, and about 20 more, plus `other`).
- **[services/analytics.py](backend/app/services/analytics.py)**: the only logging path. It records just the
  document type and whether the document was flagged. **No PII is ever logged**: no field values, names,
  amounts, filenames or exception contents.
- **[services/document_requirements.py](backend/app/services/document_requirements.py)**: reference data from
  the official LDSS-2921 instructions mapping eligibility factors to acceptable proof documents. It is not
  wired up yet; it's meant for a future "what should you upload next" feature.
- **[templates/](backend/app/templates/)**: official instruction PDFs and blank fillable forms for both
  applications.

The empty files `routes/eligibility.py`, `routes/forms.py`, `routes/speak.py`, `services/cover_sheet.py`,
`services/elevenlabs.py`, `services/eligibility_rules.py` and `services/pdf_filler.py` are placeholders for
future work.

### Frontend

[App.jsx](frontend/src/App.jsx) is a simple step machine: **consent → upload → questions → results → forms**.
Only the first two steps are built so far.

- **[context/BridgeContext.jsx](frontend/src/context/BridgeContext.jsx)**: global state. `applicant` mirrors
  the backend schema's nested shape (`household_members[]`, `incomes[]`, `shelter`, `assets[]`, ...), because
  the real PDF forms have a separate row for each household member and each income source.
- **[screens/intakeUpload.jsx](frontend/src/screens/intakeUpload.jsx)**: shows a checklist of accepted
  documents grouped by category (Identity, Income, Housing, Resources, Other). Each document can be added by
  file picker or phone camera. Uploads the backend can't recognize (`other`) are rejected, and documents
  returned with issues are marked "Needs attention".
- **[utils/mergeExtraction.js](frontend/src/utils/mergeExtraction.js)**: adds each document's results to
  `applicant` without overwriting earlier answers. Re-uploading the same document type replaces only that
  document's earlier contributions.
- **[data/documentTypes.js](frontend/src/data/documentTypes.js)**: labels and categories for the checklist.
  Its keys must match the backend `DocumentType` enum.
- **[data/QuestionBank.json](frontend/src/data/QuestionBank.json)**: follow-up questions for fields the
  documents didn't fill. It still uses the old flat field names and needs to be migrated before the questions
  screen is built.

## Dev tools

[backend/scripts/check_extraction_coverage.py](backend/scripts/check_extraction_coverage.py) runs sample
documents through the real Gemini pipeline and reports which schema fields came back filled. It makes real API
calls, so it uses quota.

```bash
python backend/scripts/check_extraction_coverage.py backend/scripts/sample_docs/*
```

There is no automated test suite yet.

## Next up

- Build the follow-up questions screen and migrate `QuestionBank.json` to the nested `applicant` shape
- Eligibility rules and results screen
- Fill the LDSS-2921 / LDSS-4826 PDFs from `applicant`
