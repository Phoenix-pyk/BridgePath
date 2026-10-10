"""
A fully filled-in applicant for /eligibility, in plain form, plus `wrap()` to produce the
{value, source} form the route receives. Also used to generate the frontend's
applicantFullMock.json (see `python -m tests.applicant_fixture <out_path>`).

All people and numbers here are fictional.
"""
import copy
import json
import sys

# Keys only the user can supply (never printed on a document); everything else is tagged "document".
USER_ONLY_KEYS = {
    "citizen_status",
    "buys_and_prepares_with_household",
    "meets_student_exemption",
    "receives_disability_benefits",
    "has_snap_disqualification",
    "is_student",
}

PLAIN_APPLICANT = {
    "primary_address": "123 Fake St, Queens, NY 11101",
    "mailing_address": None,
    "household_members": [
        {
            "first_name": "Jane", "last_name": "Testperson", "dob": "1990-01-31", "ssn": None,
            "is_applicant": True, "relationship_to_applicant": "Self",
            "is_student": False, "citizen_status": "us_citizen", "sex": "F",
            "marital_status": "Single", "highest_grade_completed": None,
            "is_pregnant": False, "pregnancy_due_date": None,
            "has_work_limiting_condition": False, "is_veteran": False, "other_names": [],
            "buys_and_prepares_with_household": True, "meets_student_exemption": None,
            "receives_disability_benefits": False, "has_snap_disqualification": False,
        },
        {
            "first_name": "Leo", "last_name": "Testperson", "dob": "2018-05-02", "ssn": None,
            "is_applicant": False, "relationship_to_applicant": "Child",
            "is_student": False, "citizen_status": "us_citizen", "sex": "M",
            "marital_status": None, "highest_grade_completed": None,
            "is_pregnant": None, "pregnancy_due_date": None,
            "has_work_limiting_condition": None, "is_veteran": None, "other_names": [],
            "buys_and_prepares_with_household": True, "meets_student_exemption": None,
            "receives_disability_benefits": False, "has_snap_disqualification": False,
        },
    ],
    "incomes": [
        {
            "individual_name": "Jane Testperson", "employer_or_source_name": "ACME CAFE LLC",
            "income_type": "wages", "gross_amount": 1300.0, "frequency": "biweekly",
            "hours_worked_per_month": 86.8, "pay_day_of_week": "Friday", "employment_type": "employed",
        }
    ],
    "shelter": {
        "rent_or_mortgage_amount": 1800.0, "frequency": "monthly",
        "landlord_name": "Fake Realty LLC", "landlord_phone": None,
        "utilities": [
            {"utility_type": "electric_lighting", "is_included_in_rent": False, "monthly_cost": 100.0}
        ],
        "property_taxes_annual": None, "homeowners_insurance_annual": None,
        "lease_start_date": "2025-09-01",
    },
    "assets": [{"resource_type": "checking", "amount": 450.0, "vehicle_year": None, "vehicle_make_model": None}],
    # User-supplied, household-level facts (not on any document)
    "household": {
        "lives_in_new_york": True,
        "receives_snap_elsewhere": False,
        "has_income": True,
        "dependent_care_monthly": 200.0,
    },
    "extra": {"phone": "718-555-0100"},
}


def wrap(node, path=()):
    """Wrap every leaf as {value, source}. Document-style sources unless user-only (see USER_ONLY_KEYS)."""
    if isinstance(node, dict):
        return {k: wrap(v, path + (k,)) for k, v in node.items()}
    if isinstance(node, list) and any(isinstance(x, dict) for x in node):
        return [wrap(x, path) for x in node]
    key = path[-1] if path else ""
    user = bool(path) and (path[0] in ("household", "extra") or key in USER_ONLY_KEYS)
    return {"value": node, "source": "user" if user else "document"}


def make():
    """Fresh deep copy of the plain applicant, safe to mutate in a test."""
    return copy.deepcopy(PLAIN_APPLICANT)


if __name__ == "__main__":
    out = sys.argv[1]
    with open(out, "w") as f:
        json.dump({"applicant": wrap(PLAIN_APPLICANT)}, f, indent=2)
    print("wrote", out)
