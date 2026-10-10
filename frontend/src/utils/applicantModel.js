// frontend/src/utils/applicantModel.js
//
// Shape of BridgeContext's `applicant`. This is also the body sent to
// POST /api/eligibility, so it follows the backend contract
// (backend/app/routes/eligibility.py, backend/tests/applicant_fixture.py):
//
// - Every leaf fact is a field: exactly { value, source }, nothing else.
//   source is "document" | "user" | null. value === null means unanswered,
//   which is what the question queue asks about. "" is a real answer (e.g.
//   "No other phone number"), see skipValue in QuestionBank.json. A list of plain values
//   (other_names, race, "who" member ids) is a single field.
// - Repeating rows (household_members, incomes, assets, utilities) are plain
//   arrays of objects whose properties are fields.
// - Bookkeeping that isn't a fact (id, _upload_id, roster_confirmed) stays a
//   bare value. The backend ignores keys it doesn't read.
// - "Who" answers store member ids, never names.
//
// Grow this shape by adding fields only. QuestionBank paths, mergeExtraction,
// eligibility and the PDF filler all depend on these names.

export function field(value = null, source = null) {
  return { value, source };
}

export function isAnswered(f) {
  return f != null && f.value !== null && f.value !== undefined;
}

function newId() {
  return crypto.randomUUID();
}

// For "Are you or anyone living with you...? If yes, who?" questions
function whoQuestion() {
  return { answer: field(), who: field() };
}

// Keys that can come from an extracted document (backend Individual model)
export const MEMBER_DOCUMENT_KEYS = [
  "first_name", "last_name", "dob", "ssn", "is_applicant", "relationship_to_applicant",
  "is_student", "citizen_status", "sex", "marital_status", "highest_grade_completed",
  "is_pregnant", "pregnancy_due_date", "has_work_limiting_condition", "is_veteran", "other_names",
];

export function makeMember(overrides = {}) {
  return {
    id: newId(),
    _upload_id: null,          // upload that created this person; null if added by the user
    roster_confirmed: false,   // set once the applicant keeps this person on the roster screen

    // Can come from documents
    first_name: field(), last_name: field(), dob: field(), ssn: field(),
    is_applicant: field(false, "user"),
    relationship_to_applicant: field(),
    is_student: field(), citizen_status: field(), sex: field(), marital_status: field(),
    highest_grade_completed: field(),
    is_pregnant: field(), pregnancy_due_date: field(),
    has_work_limiting_condition: field(), is_veteran: field(),
    other_names: field(),

    // Roster (LDSS-4826 household table)
    middle_initial: field(),
    is_applying: field(),
    buys_and_prepares_with_household: field(),

    // Per-person questions
    is_hispanic: field(),                  // voluntary
    race: field(),                         // voluntary; e.g. ["A", "B"] (codes I, A, B, P, W)
    education_level: field(),              // "0" | "1" | "2" | "3" | "4" | "5" | "8"; voluntary
    primary_language: field(),
    receives_disability_benefits: field(),
    has_medical_bills: field(),            // asked if disabled or 60+
    medical_bills_details: field(),
    has_medicaid_spenddown: field(),
    medicaid_spenddown_amount: field(),
    in_school_or_training: field(),        // ages 16-17 (is_student means at least half-time higher education)
    meets_student_exemption: field(),      // asked if 18-49 and a student; 7 CFR 273.5(b)
    school_name: field(),
    school_full_time: field(),
    school_has_income: field(),
    school_has_expenses: field(),
    foster_care_at_18: field(),
    boarder_or_foster: field(),            // "none" | "boarder" | "foster"
    has_snap_disqualification: field(),    // set from the legal.* answers that name this person

    ...overrides,
  };
}

export const INCOME_DOCUMENT_KEYS = [
  "individual_name", "employer_or_source_name", "income_type", "gross_amount", "frequency",
  "hours_worked_per_month", "pay_day_of_week", "employment_type",
];

export function makeIncome(overrides = {}) {
  return {
    id: newId(),
    _upload_id: null,
    member_id: field(),        // who receives it; keep individual_name in sync, eligibility matches on it
    individual_name: field(), employer_or_source_name: field(), income_type: field(),
    gross_amount: field(), frequency: field(), hours_worked_per_month: field(),
    pay_day_of_week: field(), employment_type: field(),
    ...overrides,
  };
}

export const ASSET_DOCUMENT_KEYS = ["resource_type", "amount", "vehicle_year", "vehicle_make_model"];

export function makeAsset(overrides = {}) {
  return {
    id: newId(),
    _upload_id: null,
    member_id: field(),        // owner
    resource_type: field(), amount: field(), vehicle_year: field(), vehicle_make_model: field(),
    ...overrides,
  };
}

export const UTILITY_DOCUMENT_KEYS = ["utility_type", "is_included_in_rent", "monthly_cost"];

export function makeUtility(overrides = {}) {
  return { utility_type: field(), is_included_in_rent: field(), monthly_cost: field(), ...overrides };
}

export const SHELTER_DOCUMENT_KEYS = [
  "rent_or_mortgage_amount", "frequency", "landlord_name", "landlord_phone",
  "property_taxes_annual", "homeowners_insurance_annual", "lease_start_date",
];

export function makeChildSupportPayment(overrides = {}) {
  return {
    id: newId(),
    member_id: field(),        // who pays
    children: field(),         // names of the children it's paid for
    amount: field(),
    frequency: field(),
    ...overrides,
  };
}

export function makeEmptyApplicant() {
  return {
    application: {
      type: field(),                       // "apply" | "recertify"
      notice_language: field(),            // "spanish_english" | "english"
      needs_alt_format: field(),           // blind/visually impaired and wants another format
      alt_format: field(),                 // "large_print" | "data_cd" | "audio_cd" | "braille"; only if needs_alt_format
    },
    extra: {
      phone: field(),
      other_phone: field(),
    },
    primary_address: field(),
    mailing_address: field(),

    // Row 1 is always the applicant
    household_members: [
      makeMember({
        is_applicant: field(true, "user"),
        relationship_to_applicant: field("Self", "user"),
        roster_confirmed: true,
      }),
    ],

    incomes: [],
    assets: [],                            // vehicles included

    shelter: {
      ...Object.fromEntries(SHELTER_DOCUMENT_KEYS.map((k) => [k, field()])),
      utilities: [],
      living_situation: field(),           // ["own", "rent", "farmworker", "no_permanent", "with_relatives"]
      pays_heat_separately: field(),
      heat_type: field(),                  // "gas" | "electric" | "oil" | "wood" | "coal" | "propane" | other text
      heat_company: field(),
      heat_account: field(),
      pays_air_conditioning: field(),
      pays_other_utilities: field(),
      someone_else_pays: field(),          // e.g. Section 8
      someone_else_pays_details: field(),
    },

    household: {
      lives_in_new_york: field(),
      receives_snap_elsewhere: field(),
      in_treatment_or_group_home: field(),
      has_income: field(),                 // asked when no document supplied any income
      has_more_income: field(),            // asked when documents did; yes adds income rows
      dependent_care_monthly: field(),     // 0 if none
      dependent_care_who: field(),         // member ids
      income_changed_last_30_days: field(),
      pending_income: field(),
      pending_income_details: field(),
      on_strike: whoQuestion(),
      has_more_cash: field(),              // yes adds checking/savings/cash asset rows
      has_financial_assets: field(),       // yes adds stocks/retirement/etc. asset rows
      has_vehicles: field(),               // yes adds vehicle asset rows
      owns_property: field(),
      property_details: field(),
      property_transferred_last_3_months: field(),
      pays_child_support: field(),
      child_support_payments: [],          // makeChildSupportPayment rows
    },

    legal: {
      fleeing_felon_or_parole_violation: whoQuestion(),
      court_found_parole_violation: whoQuestion(),
      snap_fraud_disqualified: whoQuestion(),
      traded_snap_for_weapons_or_drugs: whoQuestion(),
      sold_snap_500_or_more: whoQuestion(),
      received_duplicate_snap: whoQuestion(),
    },

    authorized_rep: {
      wants_rep: field(),
      name: field(), address: field(), phone: field(), wants_ebt_card: field(),
    },
    notes: field(),                        // LDSS-4826 page 9
  };
}
