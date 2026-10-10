# BridgePath

BridgePath AI helps people apply for New York State public assistance. An applicant uploads documents they
already have (pay stubs, IDs, leases, utility bills, bank statements, benefit letters, etc.), Gemini Vision reads
them, a short questionnaire covers whatever the documents didn't, and the app screens the household for SNAP
eligibility before pre-filling the state application forms:

- **LDSS-4826**: SNAP-only application (the current target)
- **LDSS-2921**: Common Application (Public Assistance / SNAP / Medicaid / Child Care / Services), later

The more documents someone uploads, the fewer questions they're asked.

## Status

| Area | State |
| --- | --- |
| `POST /api/extract`: Gemini document extraction | ✅ Working |
| `POST /api/eligibility`: SNAP eligibility screening | ✅ Working (51 backend tests) |
| Consent screen | ✅ Working (body copy is still placeholder text) |
| Document upload screen | ✅ Working against the real backend |
| Household roster screen | ✅ Working |
| Questions screen | ✅ Working (every LDSS-4826 question, paged, unstyled) |
| Results screen | ✅ Working, including "Answer" / "Upload" buttons to fix what's missing |
| Form filling / PDF generation | ⏳ Not started (placeholder) |
| Styling | ⏳ Screens are plain, unstyled HTML |
| Text-to-speech (ElevenLabs) | ⏳ Not started |

## Repository layout

```
backend/    FastAPI: Gemini extraction + SNAP eligibility rules
frontend/   Vite + React intake app
```

## Getting started

### Backend

Requires Python 3. A Gemini API key (https://aistudio.google.com/apikey) is only needed for document uploads;
eligibility works without one.

```bash
cd backend
python -m venv venv && source venv/bin/activate   # optional, venv/ is gitignored
pip install -r requirements.txt
echo "GEMINI_API_KEY=your-key-here" > .env
uvicorn app.main:app --reload                      # http://localhost:8000
python -m pytest tests                             # eligibility tests, no API key needed
```

Run these from inside `backend/`, because imports are rooted at `app.*`.

### Frontend

```bash
cd frontend
npm install
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # production build
npm run lint      # oxlint
```

The frontend calls the backend at `VITE_API_URL` (default `http://localhost:8000`). If the backend isn't running,
uploads show "Can't reach server". To work on the UI without the backend, set `USE_MOCK = true` in
[frontend/src/utils/api.js](frontend/src/utils/api.js), which returns canned data instead of calling the API.

**Trying the whole flow:** run both servers, agree to consent, upload documents (or skip), add people on the
roster, answer the questions, then "See my results". Skipping a question or typing an income instead of uploading
proof gives "We need a little more information" with buttons to fix each item.

## How it works

```
Consent → Upload → Roster → Questions → Results ──→ Forms (not built)
             │                    │         │  ▲
             ▼                    │         │  └── fix: Answer a question / Upload a document, then re-check
       /api/extract               │         ▼
             │                    │   /api/eligibility
             └──── applicant ◄────┘   (applicant sent through api.js)
                (BridgeContext)
```

Every piece of applicant data lives in one object, `applicant`, in BridgeContext. Each fact is stored as
`{ value, source }`, where `source` is `"document"` (extracted) or `"user"` (answered), and `value: null` means
"not answered yet". That same object is the request body for `/api/eligibility`.

### Backend

- **[routes/extract.py](backend/app/routes/extract.py)**: `POST /api/extract` takes one file (JPG, PNG or PDF,
  up to 10 MB) and returns `{ documentType, fields, issues }`. Validates in memory (files are never written to
  disk); any extraction failure becomes a generic 502.
- **[services/gemini.py](backend/app/services/gemini.py)**: exactly one Gemini call per document, structured
  output, `temperature=0`. Only transient upstream errors (429/5xx) are retried.
- **[services/pydantic_schemas.py](backend/app/services/pydantic_schemas.py)**: the extraction schema. It covers
  both forms (household members, incomes, shelter costs, assets) and only facts that could be printed on a real
  document.
- **[routes/eligibility.py](backend/app/routes/eligibility.py)** and
  **[services/eligibility_rules.py](backend/app/services/eligibility_rules.py)**: `POST /api/eligibility` takes
  `{ applicant }` and returns `eligible`, `needs_something` (with a `missing` list of questions or proof documents)
  or `not_eligible`, with a reason. It's a screening, not a determination, and doesn't estimate benefit amounts.
  Numbers live in [services/snap_standards.py](backend/app/services/snap_standards.py).
- **[services/analytics.py](backend/app/services/analytics.py)**: the only logging path. It records document type,
  flagged yes/no, benefit and status. **No PII is ever logged.**
- **[services/document_requirements.py](backend/app/services/document_requirements.py)**: which documents prove
  which eligibility factor, from the official LDSS-2921 instructions.
- **[templates/](backend/app/templates/)**: official instruction PDFs and blank fillable forms.

`routes/forms.py`, `routes/speak.py`, `services/cover_sheet.py`, `services/elevenlabs.py` and
`services/pdf_filler.py` are still empty placeholders.

### Frontend

- **Data**
  - [utils/applicantModel.js](frontend/src/utils/applicantModel.js): the shape of `applicant`. It can only grow:
    add fields, never rename them.
  - [utils/mergeExtraction.js](frontend/src/utils/mergeExtraction.js): adds each upload's results to `applicant`,
    filling only empty fields, so earlier documents and the user's answers are never overwritten.
  - [utils/api.js](frontend/src/utils/api.js): the only door to the backend. It leaves out SSNs, phone numbers and
    addresses when checking eligibility.
- **Questions**
  - [data/QuestionBank.json](frontend/src/data/QuestionBank.json): every LDSS-4826 question, with where its answer
    goes and when to ask it. Related yes/no questions are grouped into "Do any of these apply?" checklists, so one
    person with all documents sees about 23 pages.
  - [utils/questionQueue.js](frontend/src/utils/questionQueue.js) decides what to ask, and
    [utils/applicantEdits.js](frontend/src/utils/applicantEdits.js) saves the answers.
  - A question is only asked if documents didn't already answer it.
- **Screens**
  - [IntakeUpload](frontend/src/screens/intakeUpload.jsx): upload documents.
  - [RosterScreen](frontend/src/screens/RosterScreen.jsx): who lives in the household.
  - [QuestionScreen](frontend/src/screens/QuestionScreen.jsx): one question per page, with numbered pages to jump
    back and review.
  - [ResultsScreen](frontend/src/screens/ResultsScreen.jsx): the eligibility result. Each missing item gets
    **Answer** and/or **Upload** buttons. An upload made for a specific person fills that person's details, and
    uploaded proof of income replaces the amount the user typed. See
    [utils/fixPlan.js](frontend/src/utils/fixPlan.js) and [data/fixSources.js](frontend/src/data/fixSources.js).

[CLAUDE.md](CLAUDE.md) has the detailed architecture notes, open cross-team issues and post-MVP ideas.

## Dev tools

[backend/scripts/check_extraction_coverage.py](backend/scripts/check_extraction_coverage.py) runs sample documents
through the real Gemini pipeline and reports which schema fields came back filled. It makes real API calls, so it
uses quota.

```bash
python backend/scripts/check_extraction_coverage.py backend/scripts/sample_docs/*
```

The backend has eligibility tests (`python -m pytest tests` in `backend/`); the frontend has no test suite yet.

## Next up

- **Forms:** fill the LDSS-4826 PDF from `applicant` (`pdf_filler.py`) and a forms screen to download it
- **Styling:** status cards on the results screen, then a consistent look across all screens
- **Open cross-team issue:** refugees and asylees are currently screened as ineligible (see CLAUDE.md)
- **After the MVP:** see "Post-MVP improvement ideas" in CLAUDE.md (early "not eligible", saving skipped questions,
  merging duplicate people, reviewing what documents filled in)
