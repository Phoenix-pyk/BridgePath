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
| Forms screen + `POST /api/forms`: fills the official LDSS-4826 PDF | ✅ Working (download, then delete your information) |
| Styling | ⏳ Screens are plain, unstyled HTML |
| Text-to-speech (ElevenLabs) | ⏳ Not started |

## Repository layout

```
backend/    FastAPI: Gemini extraction + SNAP eligibility rules
frontend/   Vite + React intake app
```

## Getting started

> **Copying commands:** every command below is on its own line with no trailing `# comment`. On macOS's default
> shell (zsh), a pasted `# ...` is **not** treated as a comment and becomes extra arguments, e.g.
> `error: too many arguments for 'show-report'`. Paste commands as they are, one line at a time if needed.

### Backend

Requires Python 3. A Gemini API key (https://aistudio.google.com/apikey) is only needed for document uploads;
eligibility works without one. Run everything from inside `backend/`, because imports are rooted at `app.*`.

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
echo "GEMINI_API_KEY=your-key-here" > .env
uvicorn app.main:app --reload
```

| Command | What it does |
| --- | --- |
| `python -m venv venv` / `source venv/bin/activate` | Optional virtualenv (`venv/` is gitignored) |
| `pip install -r requirements.txt` | Installs dependencies. Re-run it after pulling, since new ones get added (e.g. `pypdf`, `pytest`) |
| `uvicorn app.main:app --reload` | Starts the API at http://localhost:8000 |

### Frontend

```bash
cd frontend
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm run build` | Production build |
| `npm run lint` | oxlint |

## Running the tests

There are three test suites, one per tool:

| Suite | Tool | Where | What it covers |
| --- | --- | --- | --- |
| Backend tests | **pytest** | `backend/tests/test_eligibility.py`, `test_forms.py` | SNAP eligibility rules and the `/api/eligibility` route; LDSS-4826 PDF filling and the `/api/forms` route |
| Frontend unit tests | **Vitest** | `frontend/tests/unit/*.test.js` | `questionBank` (QuestionBank.json checked against the data model), `questionnaire` (a full household run), `paging`, `mergeExtraction` (uploads), `derived` (automatic answers), `fixing` (Answer / Upload buttons), `api` (what's sent to the backend) |
| Frontend browser tests | **Playwright** | `frontend/tests/e2e/results.spec.js`, `forms.spec.js`, `upload.spec.js` (helpers in `flow.js`) | 8 results-screen scenarios, 2 forms scenarios (download the filled PDF, delete my information) and uploading several files at once, clicked through in Chrome, with screenshots |

**Backend** (eligibility + forms, no API key needed), from `backend/`:

```bash
python -m pytest tests
```

**Frontend unit tests** (questionnaire logic, fixing, merging uploads, `api.js`), from `frontend/`:

```bash
npm test
```

**Frontend browser tests** (Playwright clicks through the real app in Chrome), from `frontend/`. One-time setup
after `npm install`:

```bash
npx playwright install chromium
```

Run the scenarios, then open the report:

```bash
npm run test:e2e
```

```bash
npm run test:e2e:report
```

In the report, click a test, then look under **Attachments** for a screenshot of each step, or open **Trace** to
replay every click. The scenarios cover: not eligible (not a NY resident, income over the limit), eligible, and each
"needs something" case with its Answer / Upload fix, plus "can't reach server". They start the backend and frontend
themselves if those aren't already running, use the real eligibility backend, and answer uploads with fixtures
instead of calling Gemini.

| Also useful | What it does |
| --- | --- |
| `npx playwright test --headed` | Watch the browser click through |
| `npx playwright test --ui` | Step through tests interactively |
| `npx playwright test -g "Answer all"` | Run only tests whose name matches |

The frontend calls the backend at `VITE_API_URL` (default `http://localhost:8000`). If the backend isn't running,
uploads show "Can't reach server". To work on the UI without the backend, set `USE_MOCK = true` in
[frontend/src/utils/api.js](frontend/src/utils/api.js), which returns canned data instead of calling the API.

**Trying the whole flow:** run both servers, agree to consent, upload documents (or skip), add people on the
roster, answer the questions, then "See my results". Skipping a question or typing an income instead of uploading
proof gives "We need a little more information" with buttons to fix each item.

## How it works

```
Consent → Upload → Roster → Questions → Results ──→ Forms (download LDSS-4826)
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

- **[routes/forms.py](backend/app/routes/forms.py)** and **[services/pdf_filler.py](backend/app/services/pdf_filler.py)**:
  `POST /api/forms` takes `{ applicant, benefits }` and returns the filled official PDF(s) as base64, in memory only.

`routes/speak.py`, `services/cover_sheet.py` and `services/elevenlabs.py` are still empty placeholders.

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
  - [IntakeUpload](frontend/src/screens/intakeUpload.jsx): upload documents. Several files can be selected at once;
    they're read one after another, and any that fail are listed without stopping the rest.
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

See [Running the tests](#running-the-tests).

## Next up

- **Styling:** status cards on the results screen, then a consistent look across all screens
- **Open cross-team issue:** refugees and asylees are currently screened as ineligible (see CLAUDE.md)
- **After the MVP:** see "Post-MVP improvement ideas" in CLAUDE.md (early "not eligible", saving skipped questions,
  merging duplicate people, reviewing what documents filled in, drag-and-drop uploads)
