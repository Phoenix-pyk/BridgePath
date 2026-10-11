// Keys must match the backend DocumentType enum values in
// backend/app/services/pydantic_schemas.py. "other" is deliberately left
// out so an unrecognized document is rejected by the upload checklist.

export const CATEGORIES = ["Identity", "Income", "Housing", "Resources", "Other"];

export const DOCUMENT_TYPES = {
    // Identity
    id: { label: "Photo ID", category: "Identity" },
    birth_certificate: { label: "Birth certificate", category: "Identity" },
    social_security_card: { label: "Social Security card", category: "Identity" },
    immigration_document: { label: "Immigration document", category: "Identity" },
    // Income
    pay_stub: { label: "Pay stub", category: "Income" },
    employer_letter: { label: "Employer letter", category: "Income" },
    social_security_award_letter: { label: "Social Security / SSI award letter", category: "Income" },
    unemployment_letter: { label: "Unemployment benefit letter", category: "Income" },
    veterans_benefits_letter: { label: "Veterans benefits letter", category: "Income" },
    workers_comp_letter: { label: "Workers' comp letter", category: "Income" },
    pension_letter: { label: "Pension letter", category: "Income" },
    child_support_record: { label: "Child support record", category: "Income" },
    aid_letter: { label: "Financial aid letter", category: "Income" },
    tax_return: { label: "Tax return", category: "Income" },
    // Housing
    lease: { label: "Lease", category: "Housing" },
    mortgage_statement: { label: "Mortgage statement", category: "Housing" },
    utility_bill: { label: "Utility bill", category: "Housing" },
    property_tax_bill: { label: "Property tax bill", category: "Housing" },
    homeowners_insurance: { label: "Homeowner's insurance", category: "Housing" },
    // Resources
    bank_statement: { label: "Bank statement", category: "Resources" },
    investment_statement: { label: "Investment statement", category: "Resources" },
    life_insurance_policy: { label: "Life insurance policy", category: "Resources" },
    vehicle_document: { label: "Vehicle title / registration", category: "Resources" },
    // Other
    medical_statement: { label: "Medical statement", category: "Other" },
    school_record: { label: "School record", category: "Other" },
};
