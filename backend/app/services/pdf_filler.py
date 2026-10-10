"""
Fills the official fillable PDF for a benefit (SNAP -> LDSS-4826) from plain applicant values.

Pure and in-memory: reads the blank template, works on a copy, returns bytes. Never writes a file,
never logs or prints values. Missing values leave their boxes empty (nothing is invented).

`values` is the applicant tree with the {value, source} wrappers already removed (same shape as the
frontend's `applicant`, see frontend/src/utils/applicantModel.js). The PDF's field names are the ones in
app/templates/4826_field_names.csv; `household_members__0__*` is the applicant (checkbox variants),
rows 1+ use text boxes ("Y"/"N").
"""
import re
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

TEMPLATES = {
    "SNAP": {"name": "LDSS-4826", "file": TEMPLATES_DIR / "4826_fillable_named.pdf"},
}

# Capacity of the form's tables (rows beyond these are dropped, not errors)
MAX_MEMBERS = 8
MAX_INCOMES = 3
MAX_VEHICLES = 2
MAX_EDUCATION = 4

FREQUENCY_LABELS = {"weekly": "Weekly", "biweekly": "Every 2 weeks", "semi_monthly": "Twice a month", "monthly": "Monthly"}
TO_MONTHLY = {"weekly": 52 / 12, "biweekly": 26 / 12, "semi_monthly": 2, "monthly": 1}
ASSET_LABELS = {
    "retirement_account": "Retirement account", "stocks_bonds": "Stocks/bonds", "life_insurance": "Life insurance",
    "burial_trust_or_fund": "Burial trust/fund", "other": "Other",
}
LIVING_BOXES = {
    "own": "own_home", "rent": "renting", "farmworker": "migrant_farmworker",
    "no_permanent": "no_permanent_residence", "with_relatives": "live_with_others",
}
HEAT_BOXES = {"gas", "electric", "oil", "wood", "coal", "propane"}
# household yes/no + "who" questions in `legal.*` -> form question name
LEGAL_QUESTIONS = {
    "fleeing_felon_or_parole_violation": "probation_fleeing_felon",
    "court_found_parole_violation": "probation_violation",
    "snap_fraud_disqualified": "snap_disqualified",
    "traded_snap_for_weapons_or_drugs": "convicted_trading_for_weapons_drugs",
    "sold_snap_500_or_more": "convicted_trafficking_500",
    "received_duplicate_snap": "convicted_duplicate_benefits",
}


class UnknownBenefitError(ValueError):
    pass


# ---------------------------------------------------------------- small formatters

def _blank(v: Any) -> bool:
    return v is None or v == "" or v == []


def _date(v: Any) -> str | None:
    if _blank(v):
        return None
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").strftime("%m/%d/%Y")
    except ValueError:
        return str(v)


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or _blank(v):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _money(v: Any) -> str | None:
    n = _num(v)
    return None if n is None else f"{n:.2f}"


def _text(v: Any) -> str | None:
    return None if _blank(v) else str(v)


def _yn(v: Any) -> str | None:
    return None if not isinstance(v, bool) else ("Y" if v else "N")


def _age(dob: Any) -> int | None:
    try:
        born = datetime.strptime(str(dob)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None
    today = date.today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _split_address(raw: Any) -> dict[str, str]:
    """Best-effort split of one free-text address into street/apt/city/zip. Unparseable -> all in street."""
    if isinstance(raw, dict):
        return {k: str(raw[k]) for k in ("street", "apt", "city", "zip") if not _blank(raw.get(k))}
    if _blank(raw):
        return {}
    text = " ".join(str(raw).split())
    out: dict[str, str] = {}
    m = re.search(r"\b(\d{5})(?:-\d{4})?\s*$", text)
    if m:
        out["zip"] = m.group(1)
        text = text[: m.start()].rstrip(" ,")
    text = re.sub(r",?\s*(NY|N\.Y\.|New York)\s*$", "", text, flags=re.I).rstrip(" ,")
    parts = [p.strip() for p in text.split(",") if p.strip()]
    street = parts[0] if parts else ""
    if len(parts) > 1:
        out["city"] = parts[-1]
    a = re.search(r"(?:,|\s)\s*(?:apt\.?|apartment|unit|#)\s*([\w-]+)\s*$", street, flags=re.I)
    if a:
        out["apt"] = a.group(1)
        street = street[: a.start()].rstrip(" ,")
    if street:
        out["street"] = street
    return out


# ---------------------------------------------------------------- field builder

class _Fields:
    """Collects {pdf_field_name: str | bool}; blank values are skipped."""

    def __init__(self) -> None:
        self.out: dict[str, str | bool] = {}

    def text(self, name: str, v: Any) -> None:
        if not _blank(v):
            self.out[name] = str(v)

    def box(self, name: str, on: bool | None) -> None:
        if on:
            self.out[name] = True

    def yesno(self, topic: str, answer: bool | None, who: Any = None) -> None:
        if isinstance(answer, bool):
            self.box(f"q__{topic}__yes", answer)
            self.box(f"q__{topic}__no", not answer)
            if answer:
                self.text(f"q__{topic}__who", who)


def _fill_header(f: _Fields, a: dict) -> None:
    app = a.get("application") or {}
    f.box("form__action__apply", app.get("type") == "apply")
    f.box("form__action__recertify", app.get("type") == "recertify")
    f.box("form__notices__english", app.get("notice_language") == "english")
    f.box("form__notices__spanish_and_english", app.get("notice_language") == "spanish_english")
    alt = app.get("alt_format")
    if alt:
        f.box("form__alt_format_notices__no", alt == "none")
        f.box("form__alt_format_notices__yes", alt != "none")
        f.box(f"form__alt_format__{alt}", alt != "none")

    extra = a.get("extra") or {}
    f.text("extra__phone", extra.get("phone"))
    f.text("extra__other_phone", extra.get("other_phone"))
    for prefix, key in (("primary_address", "primary_address"), ("mailing_address", "mailing_address")):
        for part, v in _split_address(a.get(key)).items():
            f.text(f"{prefix}__{part}", v)


def _fill_members(f: _Fields, members: list[dict]) -> None:
    for i, m in enumerate(members[:MAX_MEMBERS]):
        p = f"household_members__{i}__"
        f.text(p + "first_name", m.get("first_name"))
        f.text(p + "middle_initial", m.get("middle_initial"))
        f.text(p + "last_name", m.get("last_name"))
        f.text(p + "ssn", m.get("ssn"))
        f.text(p + "dob", _date(m.get("dob")))
        f.text(p + "marital_status", m.get("marital_status"))
        f.text(p + "sex", m.get("sex"))
        race = m.get("race")
        f.text(p + "race_codes", ",".join(race) if isinstance(race, list) else race)
        if i == 0:
            f.text(p + "full_name", _full_name(m))
            f.text(p + "other_names", ", ".join(m.get("other_names") or []))
            if m.get("is_applying") is False:
                f.box(p + "is_applying__no", True)
            if m.get("buys_and_prepares_with_household") is False:
                f.box(p + "buys_and_prepares_with_household__no", True)
            if isinstance(m.get("is_hispanic"), bool):
                f.box(p + "is_hispanic_latino__yes", m["is_hispanic"])
                f.box(p + "is_hispanic_latino__no", not m["is_hispanic"])
        else:
            f.text(p + "relationship_to_applicant", m.get("relationship_to_applicant"))
            f.text(p + "is_applying", _yn(m.get("is_applying")))
            f.text(p + "buys_and_prepares_with_household", _yn(m.get("buys_and_prepares_with_household")))
            f.text(p + "is_hispanic_latino", _yn(m.get("is_hispanic")))


def _full_name(m: dict) -> str | None:
    name = " ".join(str(m[k]) for k in ("first_name", "last_name") if not _blank(m.get(k)))
    return name or None


def _names(members: list[dict], ids: Any) -> str | None:
    """Comma-joined names for a list of member ids (or member dicts)."""
    if isinstance(ids, str):
        ids = [ids]
    by_id = {m.get("id"): m for m in members}
    names = [_full_name(by_id[i]) for i in ids or [] if i in by_id]
    return ", ".join(n for n in names if n) or None


def _who(members: list[dict], pred) -> str | None:
    return ", ".join(n for n in (_full_name(m) for m in members if pred(m)) if n) or None


def _fill_incomes(f: _Fields, incomes: list[dict]) -> None:
    for i, inc in enumerate(incomes[:MAX_INCOMES]):
        p = f"incomes__{i}__"
        f.text(p + "individual_name", inc.get("individual_name"))
        f.text(p + "employer_or_source_name", inc.get("employer_or_source_name"))
        n = _num(inc.get("hours_worked_per_month"))
        f.text(p + "hours_worked_per_month", None if n is None else f"{n:g}")
        f.text(p + "frequency", FREQUENCY_LABELS.get(inc.get("frequency"), inc.get("frequency")))
        f.text(p + "gross_amount", _money(inc.get("gross_amount")))


def _fill_education(f: _Fields, members: list[dict]) -> None:
    rows = [m for m in members if any(not _blank(m.get(k)) for k in ("education_level", "highest_grade_completed", "primary_language"))]
    for i, m in enumerate(rows[:MAX_EDUCATION]):
        p = f"education__{i}__"
        f.text(p + "name", _full_name(m))
        f.text(p + "level_code", m.get("education_level"))
        f.text(p + "highest_grade", m.get("highest_grade_completed"))
        f.text(p + "primary_language", m.get("primary_language"))


def _fill_resources(f: _Fields, members: list[dict], assets: list[dict], household: dict) -> None:
    def owner(rows: list[dict]) -> str | None:
        return _names(members, [r.get("member_id") for r in rows if r.get("member_id")])

    cash = [r for r in assets if r.get("resource_type") in ("checking", "savings")]
    if cash:
        f.text("resources__cash_on_hand__amount", _money(sum(_num(r.get("amount")) or 0 for r in cash)))
        f.text("resources__cash_on_hand__belongs_to", owner(cash))

    other = [r for r in assets if r.get("resource_type") in ASSET_LABELS]
    if other:
        f.text("resources__other_financial_assets__type", ", ".join(dict.fromkeys(ASSET_LABELS[r["resource_type"]] for r in other)))
        f.text("resources__other_financial_assets__amount", _money(sum(_num(r.get("amount")) or 0 for r in other)))
        f.text("resources__other_financial_assets__owner", owner(other))

    vehicles = [r for r in assets if r.get("resource_type") == "vehicle"]
    for i, v in enumerate(vehicles[:MAX_VEHICLES]):
        make, _, model = str(v.get("vehicle_make_model") or "").partition(" ")
        f.text(f"vehicles__{i}__make", make)
        f.text(f"vehicles__{i}__model", model)
        f.text(f"vehicles__{i}__year", v.get("vehicle_year"))
        f.text(f"vehicles__{i}__owner", owner([v]))

    f.text("resources__property__description", household.get("property_details"))


def _fill_shelter(f: _Fields, shelter: dict) -> None:
    rent = _num(shelter.get("rent_or_mortgage_amount"))
    if rent is not None:
        f.text("shelter__rent_or_mortgage_amount", _money(rent * TO_MONTHLY.get(shelter.get("frequency"), 1)))
    f.text("shelter__property_taxes_annual", _money(shelter.get("property_taxes_annual")))
    f.text("shelter__homeowners_insurance_annual", _money(shelter.get("homeowners_insurance_annual")))
    for key in shelter.get("living_situation") or []:
        if key in LIVING_BOXES:
            f.box(f"form__living_arrangement__{LIVING_BOXES[key]}", True)
    heat = shelter.get("heat_type")
    if heat in HEAT_BOXES:
        f.box(f"shelter__heating_fuel__{heat}", True)
    elif not _blank(heat):
        f.box("shelter__heating_fuel__other", True)
        f.text("shelter__heating_fuel_other_text", "" if heat == "other" else heat)
    f.text("shelter__heat_company_name", shelter.get("heat_company"))
    f.text("shelter__heat_company_account_number", shelter.get("heat_account"))
    f.yesno("pays_separate_heat", shelter.get("pays_heat_separately"))
    f.yesno("pays_air_conditioning", shelter.get("pays_air_conditioning"))
    f.yesno("pays_other_utilities", shelter.get("pays_other_utilities"))
    f.yesno("others_pay_expenses", shelter.get("someone_else_pays"))
    if shelter.get("someone_else_pays"):
        f.text("q__others_pay_expenses__details", shelter.get("someone_else_pays_details"))


def _any_all(members: list[dict], key: str, pred=lambda v: v is True) -> bool | None:
    """True if any member matches, False if every member is answered and none match, else None (unknown)."""
    vals = [m.get(key) for m in members]
    if any(pred(v) for v in vals):
        return True
    return False if vals and all(v is not None for v in vals) else None


def _fill_questions(f: _Fields, a: dict, members: list[dict]) -> None:
    h = a.get("household") or {}

    statuses = [m.get("citizen_status") for m in members]
    if any(statuses):
        non = _who(members, lambda m: m.get("citizen_status") not in (None, "us_citizen"))
        f.yesno("us_citizen", non is None if all(statuses) or non else None, non)
    f.yesno("snap_elsewhere", h.get("receives_snap_elsewhere"))
    f.yesno("veteran", _any_all(members, "is_veteran"), _who(members, lambda m: m.get("is_veteran") is True))
    f.yesno("institution_resident", h.get("in_treatment_or_group_home"))

    care = _num(h.get("dependent_care_monthly"))
    if care is not None:
        f.yesno("child_care_costs", care > 0, _names(members, h.get("dependent_care_who")))
        if care > 0:
            f.text("q__child_care_costs__amount", _money(care))
            f.text("q__child_care_costs__frequency", "Monthly")
    f.yesno("income_changed_30_days", h.get("income_changed_last_30_days"))
    f.yesno("potential_income", h.get("pending_income"))

    strike = h.get("on_strike") or {}
    f.yesno("strike", strike.get("answer"), _names(members, strike.get("who")))
    f.yesno("foster_care_18", _any_all(members, "foster_care_at_18"))
    boarders = [m for m in members if m.get("boarder_or_foster") in ("boarder", "foster")]
    if boarders:
        f.yesno("boarder_or_foster", True)
        f.text("q__boarder_or_foster__name", _who(boarders, lambda m: True))
        f.box("q__boarder_or_foster__boarder", any(m["boarder_or_foster"] == "boarder" for m in boarders))
        f.box("q__boarder_or_foster__foster", any(m["boarder_or_foster"] == "foster" for m in boarders))
    elif members and all(m.get("boarder_or_foster") == "none" for m in members):
        f.yesno("boarder_or_foster", False)

    f.yesno("owns_property", h.get("owns_property"))
    f.yesno("transferred_assets", h.get("property_transferred_last_3_months"))
    f.yesno("other_financial_assets", h.get("has_financial_assets"))

    payments = h.get("child_support_payments") or []
    f.yesno("child_support_paid", h.get("pays_child_support"), _names(members, [p.get("member_id") for p in payments]))
    if h.get("pays_child_support") and payments:
        p0 = payments[0]
        f.text("q__child_support_paid__children", p0.get("children"))
        f.text("q__child_support_paid__amount", _money(p0.get("amount")))
        f.text("q__child_support_paid__frequency", FREQUENCY_LABELS.get(p0.get("frequency"), p0.get("frequency")))

    disabled = lambda m: m.get("receives_disability_benefits") is True or (_age(m.get("dob")) or 0) >= 60  # noqa: E731
    qualifiers = [m for m in members if disabled(m)]
    if qualifiers:
        f.yesno("disabled_or_60", True, _who(members, disabled))
        f.yesno("medical_bills", _any_all(qualifiers, "has_medical_bills"))

    spend = [m for m in members if m.get("has_medicaid_spenddown") is True]
    f.yesno("medicaid_spenddown", _any_all(members, "has_medicaid_spenddown"), _who(members, lambda m: m.get("has_medicaid_spenddown") is True))
    if spend:
        f.text("q__medicaid_spenddown__amount", _money(spend[0].get("medicaid_spenddown_amount")))

    teens = [m for m in members if m.get("in_school_or_training") is True]
    f.yesno("school_16_17", _any_all(members, "in_school_or_training"), _who(teens, lambda m: True))
    if teens:
        f.text("q__school_16_17__school_name", teens[0].get("school_name"))

    adults = [m for m in members if m.get("is_student") is True and 18 <= (_age(m.get("dob")) or 0) <= 49]
    if adults:
        s = adults[0]
        f.yesno("school_18_49", True, _who(adults, lambda m: True))
        f.text("q__school_18_49__school_name", s.get("school_name"))
        for key, topic in (("school_full_time", "full_time"), ("school_has_income", "income"), ("school_has_expenses", "expenses")):
            if isinstance(s.get(key), bool):
                f.box(f"q__school_18_49__{topic}__yes", s[key])
                f.box(f"q__school_18_49__{topic}__no", not s[key])

    f.yesno("pregnant", _any_all(members, "is_pregnant"), _who(members, lambda m: m.get("is_pregnant") is True))
    f.yesno("work_limiting_condition", _any_all(members, "has_work_limiting_condition"),
            _who(members, lambda m: m.get("has_work_limiting_condition") is True))

    legal = a.get("legal") or {}
    for key, topic in LEGAL_QUESTIONS.items():
        q = legal.get(key) or {}
        f.yesno(topic, q.get("answer"), _names(members, q.get("who")))


def _fill_representative(f: _Fields, a: dict) -> None:
    rep = a.get("authorized_rep") or {}
    if rep.get("wants_rep"):
        f.text("form__auth_rep__name", rep.get("name"))
        f.text("form__auth_rep__address", rep.get("address"))
        f.text("form__auth_rep__phone", rep.get("phone"))
        f.box("form__auth_rep__ebt_card", rep.get("wants_ebt_card") is True)
    f.text("form__additional_info__explanation", a.get("notes"))


def build_snap_fields(values: dict) -> dict[str, str | bool]:
    """Applicant values -> {LDSS-4826 field name: text | checked}. Signature/date boxes are left for the applicant."""
    members = [m for m in values.get("household_members") or [] if isinstance(m, dict)]
    f = _Fields()
    _fill_header(f, values)
    _fill_members(f, members)
    _fill_incomes(f, [i for i in values.get("incomes") or [] if isinstance(i, dict)])
    _fill_education(f, members)
    _fill_resources(f, members, [r for r in values.get("assets") or [] if isinstance(r, dict)], values.get("household") or {})
    _fill_shelter(f, values.get("shelter") or {})
    _fill_questions(f, values, members)
    _fill_representative(f, values)
    return f.out


BUILDERS = {"SNAP": build_snap_fields}


# ---------------------------------------------------------------- public API

def fill_form(benefit: str, values: dict) -> tuple[str, bytes]:
    """
    Returns (form name, filled PDF bytes) for a benefit. Raises UnknownBenefitError for an unknown
    benefit; any other exception means filling failed (messages never contain applicant data).
    """
    template = TEMPLATES.get(benefit)
    if template is None:
        raise UnknownBenefitError("Unknown benefit.")

    fields = BUILDERS[benefit](values if isinstance(values, dict) else {})

    reader = PdfReader(BytesIO(template["file"].read_bytes()))
    writer = PdfWriter(clone_from=reader)
    known = reader.get_fields() or {}
    pdf_values = {
        name: ("/Yes" if v is True else "/Off") if known[name].get("/FT") == "/Btn" else v
        for name, v in fields.items()
        if name in known
    }
    for page in writer.pages:
        writer.update_page_form_field_values(page, pdf_values, auto_regenerate=False)
    writer.set_need_appearances_writer(True)

    out = BytesIO()
    writer.write(out)
    return template["name"], out.getvalue()
