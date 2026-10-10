// The frontend's only door to the backend. Every request goes out, and every
// response comes back, through this file. Screens never call fetch directly.

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000"
const USE_MOCK = false; //Set to true to use canned mock data instead of the backend

async function request(path, options){
    let response;
    try {
        response = await fetch (BASE_URL+path, options);
    } catch {
        throw new Error("Can't reach server")
    }
    if(!response.ok){
        // The backend's error details are generic and PII-free by design, so they're safe to show
        let detail = null;
        try {
            detail = (await response.json()).detail;
        } catch {
            // not JSON
        }
        throw new Error(typeof detail === "string" ? detail : "Server error: " + response.status);
    }
    return response;
}

// POST /api/extract: one document → { documentType, fields, issues }
export async function extract(file) {
    if(USE_MOCK){
        await new Promise((r) => setTimeout(r, 800)); // pretend it takes time
        return{
            documentType: "pay_stub",
            fields: {
                primary_address: null, mailing_address: null,
                household_members: [],
                incomes: [{
                    individual_name: "Jane Testperson", employer_or_source_name: "ACME CAFE LLC",
                    income_type: "wages", gross_amount: 1300, frequency: "biweekly",
                    hours_worked_per_month: 86.8, pay_day_of_week: "Friday", employment_type: "employed",
                }],
                shelter: null,
                assets: [],
            },
            issues: [],
        }
    }
    const body = new FormData(); //Browser's built-in
    body.append("file", file);
    const response = await request("/api/extract",{method: "POST", body});
    return response.json();
}

// Eligibility only needs facts, not identifiers, so these are left out of the
// request. Names stay: eligibility matches incomes to people by name.
const NOT_FOR_ELIGIBILITY = {
    root: ["primary_address", "mailing_address", "extra", "authorized_rep", "notes"],
    member: ["ssn", "middle_initial", "other_names", "is_hispanic", "race", "primary_language",
        "medical_bills_details", "school_name"],
    household: ["pending_income_details", "property_details"],
    shelter: ["landlord_name", "landlord_phone", "heat_company", "heat_account", "someone_else_pays_details"],
};

function forEligibility(applicant) {
    const copy = structuredClone(applicant);
    NOT_FOR_ELIGIBILITY.root.forEach((k) => delete copy[k]);
    NOT_FOR_ELIGIBILITY.household.forEach((k) => delete copy.household[k]);
    NOT_FOR_ELIGIBILITY.shelter.forEach((k) => delete copy.shelter[k]);
    copy.household_members.forEach((m) => NOT_FOR_ELIGIBILITY.member.forEach((k) => delete m[k]));
    return copy;
}

// POST /api/forms: the FULL applicant (SSN, phones and addresses go on the
// form, so unlike checkEligibility nothing is stripped) + which benefits to
// fill → { forms: [{ name: "LDSS-4826", pdf: "<base64>" }] }
export async function createForms(applicant, benefits) {
    if(USE_MOCK){
        await new Promise((r) => setTimeout(r, 800));
        // A minimal valid one-page PDF
        const pdf = "JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+Cg==";
        return { forms: benefits.map(() => ({ name: "LDSS-4826", pdf })) };
    }
    const response = await request("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicant, benefits }),
    });
    return response.json();
}

// POST /api/eligibility: the applicant ({value, source} leaves, see applicantModel.js), minus identifiers
// → { results: [{ benefit, status, reason, estimatedAmount, missing: [{ type, item, memberIndex }] }] }
export async function checkEligibility(applicant) {
    if(USE_MOCK){
        await new Promise((r) => setTimeout(r, 800));
        return{
            results: [{
                benefit: "SNAP",
                status: "needs_something",
                reason: "We need a few more answers before we can check SNAP eligibility.",
                estimatedAmount: null,
                missing: [{ type: "question", item: "household.lives_in_new_york", memberIndex: null }],
            }],
        }
    }
    const response = await request("/api/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicant: forEligibility(applicant) }),
    });
    return response.json();
}

