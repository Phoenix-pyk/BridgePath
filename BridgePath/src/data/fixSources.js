// Which uploadable documents (keys of DOCUMENT_TYPES in documentTypes.js) can
// fix each kind of `missing` item that /api/eligibility returns. Used by the
// results screen to offer "Upload" next to (or instead of) "Answer".

// Missing *question* items (eligibility path notation) that a document can
// fill. Only fields the extraction schema actually reads (backend Individual
// model) belong here; income/asset row fields are answered, not uploaded, so a
// new document doesn't add a second copy of the same income.
export const FIELD_DOCUMENTS = {
    "household_members[].first_name": ["id", "birth_certificate", "social_security_card"],
    "household_members[].last_name": ["id", "birth_certificate", "social_security_card"],
    "household_members[].dob": ["id", "birth_certificate"],
    "household_members[].sex": ["id", "birth_certificate"],
    "household_members[].ssn": ["social_security_card"],
    "household_members[].citizen_status": ["immigration_document", "birth_certificate"],
    "household_members[].is_student": ["school_record"],
    "household_members[].is_veteran": ["veterans_benefits_letter"],
    "household_members[].is_pregnant": ["medical_statement"],
    "household_members[].has_work_limiting_condition": ["medical_statement"],
    "primary_address": ["id", "lease", "utility_bill"],
};

// Missing *document* items: proof factors (backend/app/services/document_requirements.py)
// → documents that prove them, plus a plain-language name.
export const PROOF = {
    earned_income_employer: {
        label: "Proof of job income, like recent pay stubs or a letter from the employer",
        documents: ["pay_stub", "employer_letter"],
    },
    earned_income_self_employment: {
        label: "Proof of self-employment income, like business records or a tax return",
        documents: ["tax_return"],
    },
    income_from_rent_or_room_board: {
        label: "Proof of rent paid to you by a roomer or boarder",
        documents: [],
    },
    unearned_income_social_security: {
        label: "Your Social Security or SSI award letter",
        documents: ["social_security_award_letter"],
    },
    unearned_income_veterans_benefits: {
        label: "Your veterans benefits letter",
        documents: ["veterans_benefits_letter"],
    },
    unearned_income_uib: {
        label: "Your unemployment benefits letter",
        documents: ["unemployment_letter"],
    },
    unearned_income_workers_compensation: {
        label: "Your workers' compensation letter",
        documents: ["workers_comp_letter"],
    },
    unearned_income_child_support: {
        label: "Proof of child support you receive",
        documents: ["child_support_record"],
    },
    unearned_income_private_pension: {
        label: "Your pension or annuity statement",
        documents: ["pension_letter"],
    },
    unearned_income_education_grants: {
        label: "Your financial aid award letter",
        documents: ["aid_letter"],
    },
    identity: { label: "Proof of identity, like a photo ID", documents: ["id"] },
    age: { label: "Proof of age, like a birth certificate or ID", documents: ["birth_certificate", "id"] },
    social_security_number: { label: "A Social Security card", documents: ["social_security_card"] },
    citizenship_or_noncitizen_status: {
        label: "Proof of citizenship or immigration status",
        documents: ["birth_certificate", "immigration_document"],
    },
    residence: { label: "Proof of where you live, like a lease or utility bill", documents: ["lease", "utility_bill", "id"] },
    shelter_expenses: {
        label: "Proof of housing costs, like a lease or mortgage statement",
        documents: ["lease", "mortgage_statement", "utility_bill", "property_tax_bill", "homeowners_insurance"],
    },
    resources_bank_accounts: { label: "A recent bank statement", documents: ["bank_statement"] },
    resources_stocks_bonds: { label: "A recent investment statement", documents: ["investment_statement"] },
    resources_life_insurance: { label: "Your life insurance policy", documents: ["life_insurance_policy"] },
    resources_motor_vehicle: { label: "Your vehicle title or registration", documents: ["vehicle_document"] },
    school_attendance: { label: "Proof of school enrollment", documents: ["school_record"] },
    medical_bills: { label: "Your medical bills or a statement from your provider", documents: ["medical_statement"] },
    disabled_incapacitated_pregnant: { label: "A statement from your medical provider", documents: ["medical_statement"] },
};
