# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

BridgePath AI extracts structured applicant data (household members, income, shelter costs, resources) from
uploaded documents (paystubs, IDs, leases, utility bills, bank statements, benefit award letters, etc.) using
Gemini Vision, to pre-fill the NYS public assistance applications **LDSS-2921** (Common Application — PA/SNAP/
Medicaid/Child Care/Services) and **LDSS-4826** (SNAP-only). The repo is a `backend/` (FastAPI + Gemini) and
`frontend/` (Vite + React) split. The frontend has a step-based intake flow (consent → document upload →
questions → results → forms) but only the first two steps are implemented; the backend also exposes a SNAP
eligibility screening route (`/api/eligibility`) that the frontend doesn't call yet. See below.

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

Tests (eligibility + forms; 69 tests, no live API key needed): `python -m pytest tests` from `backend/`. There is no lint
config. `/api/extract` has no tests; to sanity-check it use `TestClient` from `fastapi.testclient` against
`app.main.app`. `scripts/check_extraction_coverage.py` + `scripts/sample_docs/` are for checking extraction coverage.

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

`app/main.py` loads `.env`, builds the FastAPI app, and mounts routers under `/api` (`POST /api/extract`, `POST /api/eligibility`, `POST /api/forms`).
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
  for extraction events (`log_eligibility_event(benefit, status)` is the equivalent for eligibility). This is a hard zero-PII boundary: never log or print field values, SSNs, addresses,
  financial amounts, filenames, or raw exception content anywhere in the extraction pipeline — only
  `document_type` and a boolean `is_flagged`.
- **`app/routes/eligibility.py`** — `POST /api/eligibility`, body `{applicant: {...}}` where **every leaf is
  `{value, source}`** (`source` = `"document"` | `"user"`; bare scalars are accepted and treated as `"user"`).
  Parses the body by hand (no Pydantic) so FastAPI's 422 never echoes applicant data. Returns
  `{results: [{benefit, status, reason, estimatedAmount, missing: [{type, item, memberIndex}]}]}`; `status` is
  `eligible` | `needs_something` | `not_eligible`. 400 `"No information to check."` for an empty/unparseable body or
  an applicant with no values; 500 generic on evaluation failure. Telemetry via `log_eligibility_event(benefit, status)`.
- **`app/services/eligibility_rules.py`** — pure functions, no I/O or logging. `evaluate(values, sources)` currently
  returns SNAP only: hard disqualifiers (not NY resident, SNAP elsewhere), builds the SNAP unit (immigration status,
  buys/prepares food together, student exemption, disqualification), then the gross-income tier test. It is a
  *screening*, not a determination, and does **not** predict benefit amounts (`estimatedAmount` is always `None`;
  no shelter/deduction math). Income the user typed (source `"user"`) yields a `missing` `document` item
  (factor names from `document_requirements.py`); unanswered facts yield `missing` `question` items using paths like
  `household_members[].dob` with a `memberIndex`.
- **`app/routes/forms.py`** — `POST /api/forms`, body `{applicant, benefits: ["SNAP"]}` (same `{value, source}` applicant tree as
  `/eligibility`; reuses its `split_values_and_sources`). Parses by hand (no 422 echo). 400 `"No benefits to create forms for."` /
  `"Unknown benefit."` / `"No information to fill the forms."`; any fill failure is a generic 500
  `"Couldn't create your forms, try again."`. Returns `{forms: [{name: "LDSS-4826", pdf: <base64>}]}` — one filled form per benefit,
  **no cover sheet yet** (`cover_sheet.py` is still an empty stub; append its entry to the list when built). PDFs stay in memory;
  telemetry is `log_forms_event(benefit)` only.
- **`app/services/pdf_filler.py`** — `fill_form(benefit, values) -> (form name, pdf bytes)`; `TEMPLATES` maps SNAP to
  `4826_fillable_named.pdf`. Not a name-for-name match: `build_snap_fields` explicitly maps the applicant shape to the PDF's field
  names (address string is split into street/apt/city/zip; row 0 of the household table uses checkboxes, rows 1+ use "Y"/"N" text;
  `q__*` yes/no/who are derived from `household.*`, `legal.*` and per-member flags; tables are capped at 8 people / 3 incomes /
  2 vehicles / 4 education rows). Signature/date boxes are left blank for the applicant. Raises `UnknownBenefitError` for an unknown benefit.
- **`app/services/snap_standards.py`** — numeric constants (FY2027 poverty-level-based gross limits, tier
  percentages, eligible immigration statuses). Update each October. Some values are marked UNVERIFIED in comments.
- **`tests/`** — `test_eligibility.py` (51 tests) and `applicant_fixture.py` (a fictional full applicant plus
  `wrap()` to produce the `{value, source}` form; also generates `frontend/src/data/applicantFullMock.json`).
- **`app/services/document_requirements.py`** — static reference data (not wired into any route) transcribed
  from the official LDSS-2921 instructions' documentation-requirements table (PUB-1301, pages 18–19), mapping
  eligibility factors (e.g. "Residence", "Earned Income") to acceptable proof documents and the
  `BridgePathExtractionPayload` fields they inform. Intended as the data source for a future feature that
  aggregates multiple `/extract` results into one applicant profile and suggests what to upload next for
  still-missing fields — that aggregation feature doesn't exist yet.
- **`app/templates/`** — reference inputs, not code: `1301_ins.pdf` / `4826A_ins.pdf` are the official
  instructions for LDSS-2921 / LDSS-4826 (source of truth for schema/eligibility-factor design); `2921_fillable.pdf`
  is the blank fillable LDSS-2921 (field names still the Acrobat defaults).
  `4826_fillable_named.pdf` is the LDSS-4826 fillable form, the eventual target of `pdf_filler.py`; it is the
  single source of truth (edit it directly in Acrobat, keep names unique). `4826_fillable_original.pdf` is the
  untouched pre-rename copy, and `4826_field_names.csv` is the inventory of its 298 fields (page, position,
  printed label, original name, `NEW_NAME`). Field-name convention, separator `__`, 0-based row index:
  `household_members__i__*`, `incomes__i__*`, `shelter__*`, `primary_address__*` / `mailing_address__*`
  mirror the applicant shape; `q__<topic>__yes|no|who` are household yes/no questions; `form__*` are
  signatures/notice options; `education__i__*`, `vehicles__i__*`, `resources__*` are form-only tables; `extra__*`
  matches the frontend `extra` bucket. Every checkbox is standalone (never a radio group) with export value `Yes`.

### Frontend architecture

`frontend/src/App.jsx` is a tiny step machine (`useState("consent")`) that renders one screen per step:
`consent` → `ConsentScreen`, `upload` → `IntakeUpload`, `roster` → `RosterScreen`, `questions` → `QuestionScreen`,
`results` → `ResultsScreen`, then `forms` is still an unimplemented placeholder `<p>`. `main.jsx` wraps `<App />` in `BridgeProvider`.

- **`src/context/BridgeContext.jsx`** — the single global state store (React Context), created via
  `BridgeProvider`. Holds `applicant` (shape defined in `utils/applicantModel.js`), plus `documents`,
  `questionQueue`, `currentQuestion`, `results`, `fixing`, and `forms`, all with setters and a `reset()`.
- **`src/utils/applicantModel.js`** — defines `applicant`, which is also the exact body for `POST /api/eligibility`:
  - **Every leaf fact is `field(value, source)` = exactly `{value, source}`** (`source` `"document"` | `"user"` |
    `null`). The backend's `_is_wrapped` requires exactly those two keys, so never put extra keys on a leaf.
    `value === null` means unanswered; that's what the question queue asks about. A list of plain values
    (`other_names`, `race`, "who" member ids) is one field.
  - Repeating rows (`household_members`, `incomes`, `assets`, `shelter.utilities`, `household.child_support_payments`)
    are plain arrays of objects whose properties are fields. Rows carry bare bookkeeping (`id`, `_upload_id`,
    `roster_confirmed`), which the backend ignores.
  - `household_members[0]` always exists and is the applicant. Incomes/assets point at people via `member_id`
    (a field holding a member id); "who" answers (`household.on_strike`, `legal.*` as `{answer, who}`) also store
    member ids, never names. Eligibility still matches income by `individual_name`, so keep it in sync with `member_id`.
  - Sections beyond the extraction schema (`application`, `extra` phone, `household`, `legal`, `authorized_rep`,
    `notes`, roster/per-person member fields, extra `shelter` fields) cover the LDSS-4826 questions plus the
    eligibility rules' inputs (field names match `eligibility_rules.py`). `member.has_snap_disqualification` is
    meant to be set from the `legal.*` answers by the questions step.
  - **Shape is grow-only**: add fields, never rename/move them (QuestionBank paths, mergeExtraction, eligibility,
    and the future PDF filler depend on them).
- **`src/utils/mergeExtraction.js`** — `mergeExtraction(applicant, fields, uploadId)` wraps one upload's extracted
  plain values as `source: "document"` and only fills fields that are still empty, so earlier documents and user
  answers are never overwritten. The applicant (row 1) is fill-null merged (`other_names` unioned); every other
  person/income/asset becomes a new row tagged `_upload_id`. Incomes get `member_id` by exact normalized-name match
  when possible. `removeUploads(applicant, uploadIds)` drops those rows (and unlinks dangling `member_id`s) for the
  "fixing" re-upload flow; values already filled into the applicant/address/shelter are not reverted. No fuzzy
  name-matching of non-applicant people across documents, so duplicates are left for the roster screen.
- **`src/screens/ConsentScreen.jsx`** — static consent/disclosure screen (data collected, Gemini used to read
  documents, voice answers processed by Google, nothing is submitted on the user's behalf). Gates the "Continue"
  button on a single checkbox; still has lorem-ipsum placeholder body copy.
- **`src/screens/intakeUpload.jsx`** — working. Each upload gets a `crypto.randomUUID()` id; calls
  `setApplicant(prev => mergeExtraction(removeUploads(prev, replacedIds), response.fields, uploadId))`. Normal uploads
  are added alongside earlier ones of the same type (e.g. two birth certificates); in the "fixing" flow they replace
  earlier uploads of that type. Rejects unrecognized documents (and, when fixing, documents not being re-uploaded);
  `documents` holds `{id, type, status, issues}` per upload. Errors show `api.js`'s message (e.g. "Can't reach
  server" when the backend isn't running, or the backend's "Couldn't read this file, try again."). Continue goes to
  the roster.
- **`src/screens/RosterScreen.jsx`** — lists `household_members` (with "Found on your <document>" for people from
  uploads), lets the applicant remove anyone except themselves (`removePerson` also clears every `member_id` / "who"
  reference to them) and add people by name; Continue marks everyone `roster_confirmed`. No merge-duplicates UI yet
  (remove one copy instead).
- **`src/screens/QuestionScreen.jsx`** — paged: every applicable item from `listItems` (answered or not) is a
  numbered page, with a bottom `Pagination` bar (`« 1 … 33 [34] 35 … 92 End »`, ✓ = answered) to jump to any page,
  including answered ones to review/change. Back = previous page. After an answer or "Skip for now" it moves to the
  next unanswered page (`pickPage`, wrapping to earlier ones); the End page lists how many are still unanswered and
  has "See my results". Pages renumber as answers add/remove follow-ups. Local state only: `skipped`, `doneAdding`,
  `view`. Unstyled, like the other screens.
- **`src/screens/ResultsScreen.jsx`** — stage 1 of results: every time it opens (and on "Check again" / "Try
  again") it calls `api.checkEligibility(applicant)`, stores `response.results` in context `results`, and shows each
  benefit's status title + backend `reason`, the `missing` items as readable text (questions via
  `findQuestionForPath` + `questionText`, documents via a local `PROOF_LABELS` map of `document_requirements.py`
  factor names), and an estimate/right-to-apply disclaimer. "Answer the remaining questions" just returns to
  `questions` (skipped questions reappear because skips are per-visit). Not built yet: per-item "Answer"/"Upload"
  buttons via `fixing` (stage 2: `fixing: {type: "question", items}`; stage 3: missing documents → upload checklist,
  which needs a factor → document-type mapping that doesn't exist in the frontend yet).
- **`src/utils/questionQueue.js`** — read side, pure: `listItems(applicant, {doneAdding})` (every applicable item
  in asking order, each with `answered`), `pickPage(items, view, skipped)` (which page to show),
  `buildQueue` (unanswered, unskipped items), `evalCond` (the `askIf` grammar), `questionText` (fills `{name}`; for the applicant rewrites
  "Is {name}" → "Are you" etc., or uses the entry's `questionSelf`), `ageOf`, `memberLabel`. Items are
  `{kind: "question" | "addAnother", qid, scope, memberId?, rowId?, section}`.
- **`src/utils/applicantEdits.js`** — write side, immutable, all `source: "user"`: `applyAnswer(applicant, item,
  value)` (also syncs income `individual_name` from `member_id`, applies `alsoSet`, adds/removes `addRows` rows, and
  re-derives `has_snap_disqualification` from `legal.*` via `syncDerived`), `addRow`, `addPerson`, `removePerson`,
  `confirmRoster`. User-added rows carry bare `_added_by` (the addRows question id) and asset rows `_row_types`.

- **`src/utils/documentScanner.js`** — `pickFile(usePhoneCamera)` opens a native file input (or camera capture
  on mobile via `input.capture = "environment"`) and client-side validates type (jpg/png/pdf) and size (≤10MB)
  before resolving — a duplicate of the backend's own validation in `extract.py`, done client-side for instant
  feedback.
- **`src/utils/api.js`** — **the frontend's only door to the backend**: every request and every response goes
  through it, and screens never call `fetch` themselves. Add new endpoints (forms, speak, ...) here. `request()`
  throws an `Error` whose message is the backend's `detail` when present (those details are generic and PII-free
  by design), otherwise `"Server error: <status>"`, or `"Can't reach server"`.
  - `extract(file)` → `POST /api/extract` → `{documentType, fields, issues}`.
  - `checkEligibility(applicant)` → `POST /api/eligibility` → `{results: [...]}`. Sends `{ applicant }` minus
    identifiers eligibility doesn't need (`forEligibility`: SSN, phones, addresses, landlord/heat account, free-text
    details, voluntary demographics). Names are kept because eligibility matches income to people by name. Called by
    `ResultsScreen`.
  - `USE_MOCK` (currently `false`) makes both return canned nested-shape data without the backend.

- **`src/data/QuestionBank.json`** — every LDSS-4826 question (99 entries) plus the eligibility rules' inputs, keyed
  by question id. **File order is asking order**, grouped by `section` (`basics` → `roster` → `person` → `household`
  → `income` → `resources` → `housing` → `expenses` → `legal` → `final`). Each entry has `question` (`{name}` =
  the member's first name), `explanation`, `example`, `input`, optional `options` (`[{value, label}]`), and:
  - `scope` + `path` — where the answer is written. `household`: path from the `applicant` root; `member`: path
    inside one `household_members[]` row, asked once per person; `income` / `asset` / `child_support`: path inside
    one row of `incomes` / `assets` / `household.child_support_payments`, asked once per row.
  - `askIf` — `null` or a condition: `{field, equals | in | gt | includesAny}`, `{age: {min?, max?}}` (member scope,
    from `dob`), `{isEmpty: "<array path>"}`, `{all: [...]}`, `{any: [...]}`, `{not: ...}`. Field paths prefixed
    `member.` / `row.` mean the current person / row; anything else is from the `applicant` root.
  - `skipValue` + `skipLabel` — optional or voluntary questions store `skipValue` (e.g. `"declined"`, `""`, `[]`,
    `"NONE"`) so they count as answered and aren't asked again.
  - `addRows` (`income` | `asset` | `child_support`) on a yes/no — "yes" means let the user add rows, which then get
    that scope's questions; `rowTypes` limits `resource_type` for new asset rows. `alsoSet` writes extra fixed
    values with the answer (e.g. `shelter.frequency: "monthly"`).
  - `input` types: `text`, `longtext`, `date`, `number`, `money`, `phone`, `ssn`, `address`, `yesno`, `select`,
    `multiselect`, `list`, `member` (pick one roster member id), `members` (pick several), `who` (yes/no then pick
    members; writes `{answer, who}`), `whoFlag` (household-scope; pick members among those passing `memberAskIf`, and
    `path` is a *member* field set `true` for picked / `false` for the rest — used for pregnancy and work-limiting
    conditions, asked once for the household like the paper form instead of per person).
  - `questionSelf` — optional applicant wording when the automatic "{name}" → "you" rewrite reads wrong.
  - The queue asks a question when its target field's `value === null` and `askIf` passes (unknown age counts as
    passing). `member.has_snap_disqualification` has no question — `syncDerived` sets it from the `legal.*` answers.

**Current known gaps:** the `forms` step is a placeholder; results has no per-item fix buttons yet; "Skip for now" answers are only
remembered for the current visit to the question screen; `data/applicantFullMock.json` and
`extractFullMock.json` are fixtures for those future screens. `npm run lint` reports a few warnings (no errors).

### Open cross-team issues

**Eligible non-citizens are screened out (eligibility side, open).** Refugees, asylees and the other qualified
non-citizens listed on page 10 of `app/templates/4826A_ins.pdf` (7 CFR 273.4) can get SNAP, but
`snap_standards.ELIGIBLE_CITIZEN_STATUSES` only contains `us_citizen`, `lawful_permanent_resident`,
`cuban_haitian_entrant` and `cofa_citizen`, and `eligibility_rules.normalize_citizen_status` maps "refugee",
"asylee", "asylum", "parole", etc. to `other_noncitizen`, which is treated as not eligible. A refugee household is
therefore told it doesn't qualify.
- **Eligibility owner:** when working on eligibility, add canonical values for the eligible statuses (e.g. `refugee`,
  `asylee`, `deportation_withheld`, `trafficking_victim`, ...) to `ELIGIBLE_CITIZEN_STATUSES`, map them in
  `normalize_citizen_status`, add tests, and decide how to handle the LPR 5-year/under-18/disability conditions. The
  frontend will send exactly those value strings, so keep them stable once chosen.
- **Frontend follow-up (Phoenix):** `citizenStatus` in `frontend/src/data/QuestionBank.json` currently offers only
  the four eligible values above plus a catch-all `other_noncitizen`, so it must get one option per new status.
  **Claude: whenever you see that `ELIGIBLE_CITIZEN_STATUSES` contains values beyond those four, check whether
  `citizenStatus`'s options include them; if not, tell Phoenix to update the question (or offer to do it) before
  anything else.** Delete this issue once both sides are done.

### Unimplemented stubs

`app/routes/speak.py`, `app/services/cover_sheet.py` and `app/services/elevenlabs.py` exist as empty 0-byte files — placeholders for future work (text-to-speech via ElevenLabs, cover sheet generation). Don't assume any logic exists in them.

### Directory naming

The actual router folder on disk is `app/routes/` (not `app/routers/`, which doesn't exist) — some earlier
design notes in `app/bridgepath_extract_spec.md` reference the wrong folder name; trust the filesystem.
