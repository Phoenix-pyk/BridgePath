"""
Builds the applicant's checklist PDF: every fact BridgePath collected, organized like an online SNAP application
(myBenefits.ny.gov / ACCESS HRA), so the applicant can copy and paste each value while applying online.

Pure and in-memory like pdf_filler.fill_form: never writes a file, never logs or prints values. Facts nobody
answered are listed as "Not provided" (nothing is invented) so the applicant knows what to have ready.

Two layers: `checklist_sections(values)` turns the plain applicant tree (wrappers removed, same shape as
frontend/src/utils/applicantModel.js) into plain data (tested directly), and `_render` lays it out with reportlab.
"""
from dataclasses import dataclass, field
from datetime import date
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.document_requirements import DOCUMENT_REQUIREMENTS, DocumentRequirement
from app.services.pdf_filler import (
    CASH_ROW_SOURCE, CASH_TYPES, LEGAL_QUESTIONS, TO_MONTHLY, UnknownBenefitError,
    _blank, _date, _full_name, _money, _names, _num, _split_address,
)

CHECKLISTS = {"SNAP": "SNAP-Checklist"}

NOT_PROVIDED = "Not provided"
APPLY_ONLINE = [
    ("Anywhere in New York State", "https://mybenefits.ny.gov"),
    ("New York City", "https://a069-access.nyc.gov/accesshra"),
]

# Stored codes -> the words the applicant picked (frontend/src/data/QuestionBank.json options;
# tests/test_checklist.py checks these stay in sync). Unknown codes are shown as stored.
LABELS = {
    "application.type": {"apply": "Applying", "recertify": "Renewing"},
    "application.alt_format": {
        "none": "No", "large_print": "Large print", "data_cd": "Data CD", "audio_cd": "Audio CD", "braille": "Braille",
    },
    "application.notice_language": {"spanish_english": "Spanish and English", "english": "English"},
    "relationship_to_applicant": {"Sibling": "Brother or sister", "Friend": "Friend or roommate"},
    "sex": {"F": "Female", "M": "Male", "X": "X"},
    "marital_status": {"Single": "Single (never married)"},
    "citizen_status": {
        "us_citizen": "U.S. citizen or U.S. national",
        "lawful_permanent_resident": "Green card holder (permanent resident)",
        "cuban_haitian_entrant": "Cuban or Haitian entrant",
        "cofa_citizen": "Citizen of Micronesia, the Marshall Islands or Palau",
        "other_noncitizen": "Another immigration status",
    },
    "race": {
        "I": "Native American or Alaskan Native", "A": "Asian", "B": "Black or African American",
        "P": "Native Hawaiian or Pacific Islander", "W": "White",
    },
    "education_level": {
        "0": "Less than high school diploma or equivalency",
        "1": "High school diploma or equivalency (GED/TASC)",
        "2": "Associate degree (2-year college)",
        "3": "Bachelor's degree (4-year college)",
        "4": "Graduate degree (Master's or higher)",
        "5": "Finished an Individualized Education Plan (IEP)",
        "8": "Doesn't know",
    },
    "boarder_or_foster": {"none": "No", "boarder": "Boarder", "foster": "Foster child or foster adult"},
    "income_type": {
        "wages": "Job (wages)", "self_employment": "Self-employment", "social_security": "Social Security",
        "ssi": "SSI", "unemployment_insurance": "Unemployment", "veterans_benefits": "Veterans benefits",
        "workers_compensation": "Workers' compensation", "pension_retirement": "Pension or retirement",
        "child_support_received": "Child support", "alimony": "Alimony",
        "educational_assistance": "Grants or scholarships", "foster_care_maintenance": "Foster care payments",
        "rental_roomer_boarder": "Rent from a roomer or boarder", "other": "Other",
    },
    "frequency": {"weekly": "Every week", "biweekly": "Every two weeks", "semi_monthly": "Twice a month", "monthly": "Once a month"},
    "resource_type": {
        "checking": "Checking account", "savings": "Savings account",
        "retirement_account": "Retirement account or IRA", "stocks_bonds": "Stocks, bonds or mutual funds",
        "life_insurance": "Life insurance", "burial_trust_or_fund": "Burial fund or trust", "vehicle": "Vehicle", "other": "Other",
    },
    "living_situation": {
        "rent": "Rent", "own": "Own home or paying a mortgage", "with_relatives": "Live with relatives or friends",
        "no_permanent": "No permanent place to live", "farmworker": "Migrant or seasonal farmworker",
    },
    "heat_type": {
        "gas": "Gas", "electric": "Electric", "oil": "Oil", "propane": "Propane", "wood": "Wood", "coal": "Coal", "other": "Other",
    },
    "utility_type": {
        "heating_primary": "Heat", "electric_lighting": "Electricity", "cooking_gas": "Cooking gas",
        "water_sewer": "Water and sewer", "trash": "Trash",
    },
}

LEGAL_LABELS = {
    "fleeing_felon_or_parole_violation": "Breaking probation/parole or running from a felony charge",
    "court_found_parole_violation": "Found by a court to be violating probation or parole",
    "snap_fraud_disqualified": "Ever disqualified from SNAP for fraud or breaking rules on purpose",
    "traded_snap_for_weapons_or_drugs": "Convicted (since 9/22/1996) of trading SNAP for weapons or drugs",
    "sold_snap_500_or_more": "Convicted (since 9/22/1996) of buying or selling $500+ of SNAP",
    "received_duplicate_snap": "Convicted (since 9/22/1996) of getting SNAP in more than one place",
}
assert set(LEGAL_LABELS) == set(LEGAL_QUESTIONS)


# ---------------------------------------------------------------- plain data

@dataclass
class Block:
    """A group of (label, value) rows, e.g. one person or one income. value None = not provided."""
    title: str | None = None
    rows: list[tuple[str, str | None]] = field(default_factory=list)
    items: list[str] = field(default_factory=list)  # bullet list (documents to have ready)
    note: str | None = None

    def add(self, label: str, value: str | None) -> None:
        self.rows.append((label, value))


@dataclass
class Section:
    title: str
    blocks: list[Block] = field(default_factory=list)
    note: str | None = None


def _show(v: Any, labels: dict | None = None, skipped: str | None = None) -> str | None:
    """Display text for one stored value. "" / [] (a deliberate skip) -> `skipped`; None -> not provided."""
    if v is None:
        return None
    if v == "" or v == []:
        return skipped
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, list):
        return ", ".join(str((labels or {}).get(x, x)) for x in v)
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str((labels or {}).get(v, v))


def _who_answer(q: Any, members: list[dict]) -> str | None:
    """{answer, who} -> "Yes: Leo Testperson" / "No"."""
    q = q if isinstance(q, dict) else {}
    answer = q.get("answer")
    if not isinstance(answer, bool):
        return None
    if not answer:
        return "No"
    who = _names(members, q.get("who"))
    return f"Yes: {who}" if who else "Yes"


def _address_rows(b: Block, label: str, raw: Any, skipped: str) -> None:
    b.add(label, _show(raw, skipped=skipped))
    if _blank(raw):
        return
    parts = _split_address(raw)
    b.add(f"{label}: street", parts.get("street"))
    b.add(f"{label}: apartment", parts.get("apt") or "None")
    b.add(f"{label}: city", parts.get("city"))
    b.add(f"{label}: state", "NY")
    b.add(f"{label}: ZIP code", parts.get("zip"))


def _member_title(m: dict, i: int) -> str:
    name = _full_name(m) or f"Person {i + 1}"
    return f"You ({name})" if i == 0 else name


def _about_you(a: dict, members: list[dict]) -> Section:
    me = members[0] if members else {}
    app, extra = a.get("application") or {}, a.get("extra") or {}
    b = Block()
    b.add("Applying or renewing", _show(app.get("type"), LABELS["application.type"]))
    b.add("Full name", _full_name(me))
    b.add("Date of birth", _date(me.get("dob")))
    b.add("Social Security number", _show(me.get("ssn"), {"NONE": "Doesn't have one"}))
    b.add("Phone number", _show(extra.get("phone")))
    b.add("Other phone number", _show(extra.get("other_phone"), skipped="None"))
    _address_rows(b, "Home address", a.get("primary_address"), "No permanent address")
    _address_rows(b, "Mailing address", a.get("mailing_address"), "Same as home address")
    b.add("Language for letters", _show(app.get("notice_language"), LABELS["application.notice_language"]))
    if app.get("needs_alt_format") is not None:
        b.add("Letters in another format (blind or visually impaired)", _show(app.get("alt_format"), LABELS["application.alt_format"]))
    return Section("About you", [b])


def _member_block(m: dict, i: int) -> Block:
    b = Block(_member_title(m, i))
    b.add("First name", _show(m.get("first_name")))
    b.add("Middle initial", _show(m.get("middle_initial"), skipped="None"))
    b.add("Last name", _show(m.get("last_name")))
    b.add("Other names used", _show(m.get("other_names"), skipped="None"))
    if i > 0:
        b.add("Relationship to you", _show(m.get("relationship_to_applicant"), LABELS["relationship_to_applicant"]))
    b.add("Date of birth", _date(m.get("dob")))
    b.add("Social Security number", _show(m.get("ssn"), {"NONE": "Doesn't have one"}))
    b.add("Sex", _show(m.get("sex"), LABELS["sex"]))
    b.add("Marital status", _show(m.get("marital_status"), LABELS["marital_status"]))
    b.add("Citizenship / immigration status", _show(m.get("citizen_status"), LABELS["citizen_status"]))
    b.add("Applying for SNAP", _show(m.get("is_applying")))
    if i > 0:
        b.add("Buys and makes food with you", _show(m.get("buys_and_prepares_with_household")))
    b.add("Hispanic or Latino", _show(m.get("is_hispanic"), skipped="Prefer not to say"))
    b.add("Race", _show(m.get("race"), LABELS["race"], skipped="Prefer not to say"))
    b.add("Highest school finished", _show(m.get("education_level"), LABELS["education_level"], skipped="Prefer not to say"))
    if not _blank(m.get("highest_grade_completed")):
        b.add("Highest grade completed", _show(m.get("highest_grade_completed")))
    b.add("Language spoken most often", _show(m.get("primary_language"), skipped="Prefer not to say"))
    b.add("In college or trade school (at least half-time)", _show(m.get("is_student")))
    if m.get("in_school_or_training") is True:
        b.add("In school or training (age 16-17)", "Yes")
    if m.get("is_student") is True or m.get("in_school_or_training") is True:
        b.add("School name", _show(m.get("school_name")))
    if m.get("is_student") is True:
        b.add("Full-time student", _show(m.get("school_full_time")))
        b.add("Gets money from school", _show(m.get("school_has_income")))
        b.add("Pays school costs", _show(m.get("school_has_expenses")))
        b.add("Meets a student exception (works, cares for a child...)", _show(m.get("meets_student_exemption")))
    b.add("Pregnant", _show(m.get("is_pregnant")))
    if m.get("is_pregnant") is True:
        b.add("Baby due date", _date(m.get("pregnancy_due_date")) or _show(m.get("pregnancy_due_date"), skipped="Not known yet"))
    b.add("Medical condition that limits work", _show(m.get("has_work_limiting_condition")))
    b.add("Gets disability benefits", _show(m.get("receives_disability_benefits")))
    b.add("Veteran", _show(m.get("is_veteran")))
    b.add("In foster care on 18th birthday", _show(m.get("foster_care_at_18")))
    b.add("Boarder or foster", _show(m.get("boarder_or_foster"), LABELS["boarder_or_foster"]))
    return b


def _income(a: dict, members: list[dict], incomes: list[dict]) -> Section:
    h = a.get("household") or {}
    s = Section("Income", note="Amounts are before taxes and deductions.")
    if not incomes:
        s.blocks.append(Block(note="No income was entered." if h.get("has_income") is False else "No income rows were entered."))
    for n, inc in enumerate(incomes, 1):
        who = _show(inc.get("individual_name")) or _names(members, inc.get("member_id"))
        b = Block(f"Income {n}" + (f": {who}" if who else ""))
        b.add("Who gets it", who)
        b.add("Kind of income", _show(inc.get("income_type"), LABELS["income_type"]))
        b.add("Employer or who pays it", _show(inc.get("employer_or_source_name")))
        b.add("Amount each payment ($)", _money(inc.get("gross_amount")))
        b.add("How often", _show(inc.get("frequency"), LABELS["frequency"]))
        gross, per = _num(inc.get("gross_amount")), TO_MONTHLY.get(inc.get("frequency"))
        b.add("About per month ($)", _money(gross * per) if gross is not None and per else None)
        if not _blank(inc.get("hours_worked_per_month")) or inc.get("income_type") in ("wages", "self_employment"):
            b.add("Hours worked per month", _show(inc.get("hours_worked_per_month")))
        if not _blank(inc.get("pay_day_of_week")):
            b.add("Pay day", _show(inc.get("pay_day_of_week")))
        s.blocks.append(b)
    b = Block("Changes to income")
    b.add("Job or income changed in the last 30 days", _show(h.get("income_changed_last_30_days")))
    b.add("Expecting income not received yet", _show(h.get("pending_income")))
    if h.get("pending_income") is True:
        b.add("Income expected", _show(h.get("pending_income_details")))
    b.add("Anyone on strike", _who_answer(h.get("on_strike"), members))
    s.blocks.append(b)
    return s


def _is_cash(r: dict) -> bool:
    return r.get("resource_type") in CASH_TYPES or (
        r.get("resource_type") == "other" and r.get("_added_by") == CASH_ROW_SOURCE
    )


def _resources(a: dict, members: list[dict], assets: list[dict]) -> Section:
    h = a.get("household") or {}
    s = Section("Money and property")
    for n, r in enumerate(assets, 1):
        kind = "Cash" if r.get("resource_type") == "other" and _is_cash(r) else _show(r.get("resource_type"), LABELS["resource_type"])
        b = Block(f"{kind or 'Item'} {n}")
        b.add("Kind", kind)
        b.add("Belongs to", _names(members, r.get("member_id")))
        if r.get("resource_type") == "vehicle":
            b.add("Year", _show(r.get("vehicle_year")))
            b.add("Make and model", _show(r.get("vehicle_make_model")))
        b.add("Amount or value ($)", _money(r.get("amount")))
        s.blocks.append(b)
    b = Block("Property" if assets else None)
    if not assets:
        b.note = "No bank accounts, cash, investments or vehicles were entered."
    b.add("Owns property (home, land, buildings)", _show(h.get("owns_property")))
    if h.get("owns_property") is True:
        b.add("Property and who owns it", _show(h.get("property_details")))
    b.add("Sold or gave away property in the last 3 months to qualify", _show(h.get("property_transferred_last_3_months")))
    s.blocks.append(b)
    return s


def _housing(a: dict) -> Section:
    sh = a.get("shelter") or {}
    b = Block()
    b.add("Where you live", _show(sh.get("living_situation"), LABELS["living_situation"]))
    b.add("Rent or mortgage ($)", _money(sh.get("rent_or_mortgage_amount")))
    b.add("How often", _show(sh.get("frequency"), LABELS["frequency"]))
    b.add("Landlord or mortgage company", _show(sh.get("landlord_name")))
    if not _blank(sh.get("landlord_phone")):
        b.add("Landlord phone", _show(sh.get("landlord_phone")))
    if not _blank(sh.get("lease_start_date")):
        b.add("Lease start date", _date(sh.get("lease_start_date")))
    if not _blank(sh.get("property_taxes_annual")) or "own" in (sh.get("living_situation") or []):
        b.add("Property taxes per year ($)", _money(sh.get("property_taxes_annual")))
        b.add("Homeowner's insurance per year ($)", _money(sh.get("homeowners_insurance_annual")))
    b.add("Pays for heat separately", _show(sh.get("pays_heat_separately")))
    if sh.get("pays_heat_separately") is True:
        b.add("Kind of heat", _show(sh.get("heat_type"), LABELS["heat_type"]))
        b.add("Heating company", _show(sh.get("heat_company")))
        b.add("Heating account number", _show(sh.get("heat_account"), skipped="Don't have it"))
    b.add("Pays for air conditioning", _show(sh.get("pays_air_conditioning")))
    b.add("Pays other utilities (electricity, cooking gas, water, trash)", _show(sh.get("pays_other_utilities")))
    b.add("Someone else pays some housing costs", _show(sh.get("someone_else_pays")))
    if sh.get("someone_else_pays") is True:
        b.add("Who pays what", _show(sh.get("someone_else_pays_details")))
    blocks = [b]
    for n, u in enumerate([u for u in sh.get("utilities") or [] if isinstance(u, dict)], 1):
        ub = Block(f"Utility bill {n}")
        ub.add("Kind", _show(u.get("utility_type"), LABELS["utility_type"]))
        ub.add("Cost per month ($)", _money(u.get("monthly_cost")))
        ub.add("Included in rent", _show(u.get("is_included_in_rent")))
        blocks.append(ub)
    return Section("Housing and utilities", blocks)


def _expenses(a: dict, members: list[dict]) -> Section:
    h = a.get("household") or {}
    b = Block("Child or adult dependent care")
    care = _num(h.get("dependent_care_monthly"))
    b.add("Cost per month ($)", _money(care))
    if care:
        b.add("Who pays for it", _names(members, h.get("dependent_care_who")))
    blocks = [b]

    b = Block("Child support paid")
    b.add("Pays court-ordered child support", _show(h.get("pays_child_support")))
    blocks.append(b)
    if h.get("pays_child_support") is True:
        for n, p in enumerate([p for p in h.get("child_support_payments") or [] if isinstance(p, dict)], 1):
            pb = Block(f"Child support payment {n}")
            pb.add("Who pays it", _names(members, p.get("member_id")))
            pb.add("For which children", _show(p.get("children")))
            pb.add("Amount each payment ($)", _money(p.get("amount")))
            pb.add("How often", _show(p.get("frequency"), LABELS["frequency"]))
            blocks.append(pb)

    for i, m in enumerate(members):
        rows = []
        if m.get("has_medical_bills") is not None:
            rows.append(("Has medical bills", _show(m.get("has_medical_bills"))))
            if m.get("has_medical_bills") is True:
                rows.append(("Medical bills: what, how much, who pays", _show(m.get("medical_bills_details"))))
        if m.get("has_medicaid_spenddown") is not None:
            rows.append(("On Medicaid with a spenddown", _show(m.get("has_medicaid_spenddown"))))
            if m.get("has_medicaid_spenddown") is True:
                rows.append(("Spenddown per month ($)", _money(m.get("medicaid_spenddown_amount"))))
        if rows:
            blocks.append(Block(f"Medical: {_member_title(m, i)}", rows))
    return Section("Expenses", blocks)


def _other_questions(a: dict, members: list[dict]) -> Section:
    h, legal = a.get("household") or {}, a.get("legal") or {}
    b = Block()
    b.add("Lives in New York State", _show(h.get("lives_in_new_york")))
    b.add("Getting SNAP or cash assistance somewhere else", _show(h.get("receives_snap_elsewhere")))
    b.add("Lives in a treatment center or group home", _show(h.get("in_treatment_or_group_home")))
    for key, label in LEGAL_LABELS.items():
        b.add(label, _who_answer(legal.get(key), members))
    return Section("Other questions", [b])


def _representative(a: dict) -> Section:
    rep = a.get("authorized_rep") or {}
    b = Block()
    b.add("Wants an authorized representative", _show(rep.get("wants_rep")))
    if rep.get("wants_rep") is True:
        b.add("Representative's name", _show(rep.get("name")))
        b.add("Representative's address", _show(rep.get("address")))
        b.add("Representative's phone", _show(rep.get("phone")))
        b.add("Representative gets their own EBT card", _show(rep.get("wants_ebt_card")))
    b.add("Anything else SNAP should know", _show(a.get("notes"), skipped="Nothing to add"))
    return Section("Representative and notes", [b])


def documents_to_have_ready(a: dict, members: list[dict], incomes: list[dict], assets: list[dict]) -> list[DocumentRequirement]:
    """Proof the office may ask for, picked from document_requirements.py for this household."""
    h, sh = a.get("household") or {}, a.get("shelter") or {}
    present = {f"incomes[].income_type={i.get('income_type')}" for i in incomes if i.get("income_type") != "other"}
    present |= {f"assets[].resource_type={r.get('resource_type')}" for r in assets}

    wanted = {"identity", "residence"}
    if any(m.get("citizen_status") not in (None, "us_citizen") for m in members):
        wanted.add("citizenship_or_noncitizen_status")
    if any(_num(sh.get(k)) for k in ("rent_or_mortgage_amount", "property_taxes_annual", "homeowners_insurance_annual")) or sh.get("utilities"):
        wanted.add("shelter_expenses")
    if _num(h.get("dependent_care_monthly")) or h.get("pays_child_support") is True:
        wanted.add("other_expenses_dependent_care")
    if any(m.get("has_medical_bills") is True for m in members):
        wanted.add("medical_bills")
    if any(m.get(k) is True for m in members for k in ("is_pregnant", "has_work_limiting_condition", "receives_disability_benefits")):
        wanted.add("disabled_incapacitated_pregnant")
    if any(m.get(k) is True for m in members for k in ("is_student", "in_school_or_training")):
        wanted.add("school_attendance")
    return [r for r in DOCUMENT_REQUIREMENTS if r.factor in wanted or present & set(r.related_fields)]


def checklist_sections(values: dict) -> list[Section]:
    """Plain applicant values -> the checklist's sections, in online-application order."""
    a = values if isinstance(values, dict) else {}
    members = [m for m in a.get("household_members") or [] if isinstance(m, dict)]
    incomes = [i for i in a.get("incomes") or [] if isinstance(i, dict)]
    assets = [r for r in a.get("assets") or [] if isinstance(r, dict)]

    docs = Section(
        "Documents to have ready",
        [Block(r.label, items=r.acceptable_documents) for r in documents_to_have_ready(a, members, incomes, assets)],
        note="The office may ask for proof. Any one document from each list is usually enough.",
    )
    return [
        _about_you(a, members),
        Section("Household members", [_member_block(m, i) for i, m in enumerate(members)],
                note=f"{len(members)} {'person' if len(members) == 1 else 'people'} in your household."),
        _income(a, members, incomes),
        _resources(a, members, assets),
        _housing(a),
        _expenses(a, members),
        _other_questions(a, members),
        _representative(a),
        docs,
    ]


# ---------------------------------------------------------------- PDF layout

INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
ACCENT = colors.HexColor("#1d4ed8")
RULE = colors.HexColor("#d1d5db")
BAND = colors.HexColor("#f3f4f6")

_STYLES = {
    "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=INK, spaceAfter=4),
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=12.5, textColor=INK, alignment=TA_LEFT),
    "muted": ParagraphStyle("muted", fontName="Helvetica", fontSize=8.5, leading=11, textColor=MUTED),
    "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=ACCENT),
    "block": ParagraphStyle("block", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=INK, spaceBefore=6, spaceAfter=2),
    "label": ParagraphStyle("label", fontName="Helvetica", fontSize=9, leading=11.5, textColor=MUTED),
    "value": ParagraphStyle("value", fontName="Helvetica-Bold", fontSize=9.5, leading=12, textColor=INK),
    "blank": ParagraphStyle("blank", fontName="Helvetica-Oblique", fontSize=9, leading=12, textColor=MUTED),
}

PAGE_W, _ = letter
MARGIN = 0.7 * inch
CONTENT_W = PAGE_W - 2 * MARGIN
LABEL_W = 2.6 * inch


def _p(text: str, style: str) -> Paragraph:
    return Paragraph(escape(text), _STYLES[style])


def _rows_table(rows: list[tuple[str, str | None]]) -> Table:
    data = [[_p(label, "label"), _p(value, "value") if value is not None else _p(NOT_PROVIDED, "blank")] for label, value in rows]
    t = Table(data, colWidths=[LABEL_W, CONTENT_W - LABEL_W])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _section_header(title: str) -> Table:
    """Section title with an empty box to tick once that part of the online application is done."""
    box = Table([[""]], colWidths=[11], rowHeights=[11])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 1, ACCENT)]))
    t = Table([[box, _p(title, "section")]], colWidths=[20, CONTENT_W - 20])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), BAND),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 0.45 * inch, "BridgePath SNAP checklist - contains private information, keep it safe")
    canvas.drawRightString(PAGE_W - MARGIN, 0.45 * inch, f"Page {doc.page}")
    canvas.restoreState()


def _render(sections: list[Section]) -> bytes:
    story: list = [
        _p("Your SNAP application checklist", "title"),
        _p(f"Made by BridgePath on {date.today().strftime('%m/%d/%Y')}", "muted"),
        Spacer(1, 8),
        _p("Use this list while you fill out the official SNAP application online. Copy each answer into the "
           "matching question, and tick the box next to each section when you finish it.", "body"),
        Spacer(1, 4),
    ]
    for where, url in APPLY_ONLINE:
        story.append(Paragraph(f"{escape(where)}: <link href=\"{url}\" color=\"#1d4ed8\">{escape(url)}</link>", _STYLES["body"]))
    story += [
        Spacer(1, 4),
        _p("\"Not provided\" means BridgePath doesn't have that answer, so have it ready. This page has your Social "
           "Security number: keep it private. BridgePath does not submit anything for you.", "muted"),
        Spacer(1, 10),
    ]

    for s in sections:
        head = [_section_header(s.title)]
        if s.note:
            head += [Spacer(1, 3), _p(s.note, "muted")]
        first = True
        for b in s.blocks:
            parts: list = []
            if b.title:
                parts.append(_p(b.title, "block"))
            if b.note:
                parts.append(_p(b.note, "muted"))
            if b.rows:
                parts.append(_rows_table(b.rows))
            for item in b.items:
                parts.append(Paragraph(f"&bull; {escape(item)}", _STYLES["body"]))
            parts.append(Spacer(1, 4))
            # Keep the section title with its first block, and each block on one page when it fits
            story.append(KeepTogether(head + parts if first else parts))
            first = False
        if first:
            story.append(KeepTogether(head))
        story.append(Spacer(1, 10))

    out = BytesIO()
    doc = SimpleDocTemplate(
        out, pagesize=letter, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=0.8 * inch,
        title="SNAP application checklist", author="BridgePath",
    )
    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return out.getvalue()


# ---------------------------------------------------------------- public API

def build_checklist(benefit: str, values: dict) -> tuple[str, bytes]:
    """
    Returns (checklist name, PDF bytes) for a benefit. Raises UnknownBenefitError for an unknown benefit;
    any other exception means building failed (messages never contain applicant data).
    """
    name = CHECKLISTS.get(benefit)
    if name is None:
        raise UnknownBenefitError("Unknown benefit.")
    return name, _render(checklist_sections(values if isinstance(values, dict) else {}))
