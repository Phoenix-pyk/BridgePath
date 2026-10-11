import json
from io import BytesIO
from pathlib import Path

import pytest
from pypdf import PdfReader

from app.services.checklist import LABELS, NOT_PROVIDED, build_checklist, checklist_sections
from app.services.pdf_filler import UnknownBenefitError
from tests.test_forms import applicant

QUESTION_BANK = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "QuestionBank.json"


def rows(values):
    """{section title: {block title: {label: value}}} for easy lookups."""
    return {
        s.title: {b.title: dict(b.rows) for b in s.blocks}
        for s in checklist_sections(values)
    }


def test_sections_are_in_online_application_order():
    titles = [s.title for s in checklist_sections(applicant())]
    assert titles == [
        "About you", "Household members", "Income", "Money and property", "Housing and utilities",
        "Expenses", "Other questions", "Representative and notes", "Documents to have ready",
    ]


def test_values_are_ready_to_copy():
    r = rows(applicant())
    about = r["About you"][None]
    assert about["Full name"] == "Jane Testperson"
    assert about["Date of birth"] == "01/31/1990"
    assert about["Phone number"] == "718-555-0100"
    assert about["Home address: street"] == "123 Fake St"
    assert about["Home address: city"] == "Queens"
    assert about["Home address: ZIP code"] == "11101"
    assert about["Applying or renewing"] == "Applying"

    leo = r["Household members"]["Leo Testperson"]
    assert leo["Relationship to you"] == "Child"
    assert leo["Citizenship / immigration status"] == "U.S. citizen or U.S. national"
    assert leo["Sex"] == "Male"
    assert "Relationship to you" not in r["Household members"]["You (Jane Testperson)"]

    income = r["Income"]["Income 1: Jane Testperson"]
    assert income["Amount each payment ($)"] == "1300.00"
    assert income["How often"] == "Every two weeks"
    assert income["About per month ($)"] == "2816.67"
    assert income["Kind of income"] == "Job (wages)"

    assert r["Money and property"]["Checking account 1"]["Amount or value ($)"] == "450.00"
    assert r["Money and property"]["Checking account 1"]["Belongs to"] is None  # no owner in the fixture
    assert r["Housing and utilities"][None]["Rent or mortgage ($)"] == "1800.00"
    assert r["Housing and utilities"]["Utility bill 1"]["Kind"] == "Electricity"
    assert r["Other questions"][None]["Ever disqualified from SNAP for fraud or breaking rules on purpose"] == "Yes: Leo Testperson"
    assert r["Income"]["Changes to income"]["Anyone on strike"] == "No"


def test_unanswered_facts_are_not_invented():
    r = rows({"household_members": [{"first_name": "Jane"}]})
    me = r["Household members"]["You (Jane)"]
    assert me["First name"] == "Jane"
    assert me["Last name"] is None and me["Date of birth"] is None and me["Social Security number"] is None
    assert r["About you"][None]["Home address"] is None
    assert "Home address: street" not in r["About you"][None]


def test_deliberate_skips_read_as_answers():
    a = applicant()
    a["household_members"][0].update({"ssn": "NONE", "race": "", "middle_initial": ""})
    a["mailing_address"] = ""
    a["extra"]["other_phone"] = ""
    r = rows(a)
    me = r["Household members"]["You (Jane Testperson)"]
    assert me["Social Security number"] == "Doesn't have one"
    assert me["Race"] == "Prefer not to say"
    assert me["Middle initial"] == "None"
    assert r["About you"][None]["Mailing address"] == "Same as home address"
    assert r["About you"][None]["Other phone number"] == "None"


def test_documents_to_have_ready_fit_the_household():
    docs = rows(applicant())["Documents to have ready"]
    assert {"Identity", "Residence", "Earned Income (from employer)", "Shelter Expenses",
            "Resources: Bank Accounts (checking, savings, retirement - IRA/Keogh)"} <= set(docs)
    assert "Resources: Motor Vehicle" not in docs and "Medical Bills" not in docs
    section = next(s for s in checklist_sections(applicant()) if s.title == "Documents to have ready")
    assert "Current wage stubs" in next(b for b in section.blocks if b.title == "Earned Income (from employer)").items


def test_pdf_text_is_selectable():
    name, pdf = build_checklist("SNAP", applicant())
    assert name == "SNAP-Checklist" and pdf.startswith(b"%PDF")
    text = "".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    for expected in ("Your SNAP application checklist", "Jane Testperson", "123 Fake St", "1300.00", "mybenefits.ny.gov"):
        assert expected in text
    assert NOT_PROVIDED in text


def test_pdf_handles_an_almost_empty_applicant():
    _, pdf = build_checklist("SNAP", {"household_members": [{"first_name": "Jane & <Co>"}]})
    assert "Jane & <Co>" in PdfReader(BytesIO(pdf)).pages[0].extract_text()


def test_unknown_benefit_raises():
    with pytest.raises(UnknownBenefitError):
        build_checklist("Fair Fares", applicant())


@pytest.mark.skipif(not QUESTION_BANK.exists(), reason="frontend not checked out")
@pytest.mark.parametrize("qid,labels", [
    ("applicationType", "application.type"), ("altFormat", "application.alt_format"), ("sex", "sex"),
    ("citizenStatus", "citizen_status"), ("race", "race"), ("educationLevel", "education_level"),
    ("boarderOrFoster", "boarder_or_foster"), ("incomeType", "income_type"), ("incomeFrequency", "frequency"),
    ("childSupportFrequency", "frequency"), ("assetType", "resource_type"), ("livingSituation", "living_situation"),
    ("heatType", "heat_type"),
])
def test_labels_cover_every_question_option(qid, labels):
    options = json.loads(QUESTION_BANK.read_text(encoding="utf-8"))[qid]["options"]
    assert {o["value"] for o in options} <= set(LABELS[labels])
