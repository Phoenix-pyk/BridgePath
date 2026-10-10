import base64
import copy
import logging
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.main import app
from app.services.pdf_filler import TEMPLATES, UnknownBenefitError, _split_address, build_snap_fields, fill_form
from tests.applicant_fixture import PLAIN_APPLICANT, wrap

client = TestClient(app)


def applicant():
    a = copy.deepcopy(PLAIN_APPLICANT)
    a["household_members"][0]["id"] = "m0"
    a["household_members"][1]["id"] = "m1"
    a["household_members"][1]["is_applying"] = True
    a["household_members"][1]["is_hispanic"] = False
    a["incomes"][0]["member_id"] = "m0"
    a["application"] = {"type": "apply", "notice_language": "english", "alt_format": "none"}
    a["household"]["on_strike"] = {"answer": False, "who": []}
    a["household"]["property_details"] = None
    a["shelter"].update({"living_situation": ["rent"], "heat_type": "gas", "pays_heat_separately": True})
    a["legal"] = {"snap_fraud_disqualified": {"answer": True, "who": ["m1"]}}
    return a


def filled(values):
    _, pdf = fill_form("SNAP", values)
    return {k: v.get("/V") for k, v in PdfReader(BytesIO(pdf)).get_fields().items()}


def test_fills_text_and_checkboxes():
    f = filled(applicant())
    assert f["household_members__0__first_name"] == "Jane"
    assert f["household_members__0__full_name"] == "Jane Testperson"
    assert f["household_members__0__dob"] == "01/31/1990"
    assert f["household_members__1__relationship_to_applicant"] == "Child"
    assert f["household_members__1__is_applying"] == "Y"
    assert f["primary_address__street"] == "123 Fake St"
    assert f["primary_address__city"] == "Queens"
    assert f["primary_address__zip"] == "11101"
    assert f["incomes__0__gross_amount"] == "1300.00"
    assert f["incomes__0__frequency"] == "Every 2 weeks"
    assert f["shelter__rent_or_mortgage_amount"] == "1800.00"
    assert f["extra__phone"] == "718-555-0100"
    assert f["form__action__apply"] == "/Yes"
    assert f["form__living_arrangement__renting"] == "/Yes"
    assert f["shelter__heating_fuel__gas"] == "/Yes"
    assert f["q__snap_elsewhere__no"] == "/Yes"
    assert f["q__snap_disqualified__yes"] == "/Yes"
    assert f["q__snap_disqualified__who"] == "Leo Testperson"
    assert f["resources__cash_on_hand__amount"] == "450.00"


def test_missing_values_stay_empty_and_nothing_is_invented():
    fields = build_snap_fields({"household_members": [{"first_name": "Jane"}]})
    assert fields == {"household_members__0__first_name": "Jane", "household_members__0__full_name": "Jane"}
    f = filled({"household_members": [{"first_name": "Jane"}]})
    assert not f["household_members__0__last_name"]
    assert not f["form__applicant_signature"]


def test_blank_template_is_unchanged():
    path = TEMPLATES["SNAP"]["file"]
    before = path.read_bytes()
    fill_form("SNAP", applicant())
    assert path.read_bytes() == before


def test_unknown_benefit_raises():
    with pytest.raises(UnknownBenefitError):
        fill_form("Fair Fares", applicant())


def test_every_generated_field_exists_in_the_pdf():
    names = set(PdfReader(str(TEMPLATES["SNAP"]["file"])).get_fields())
    assert set(build_snap_fields(applicant())) <= names


def test_rows_beyond_table_capacity_are_dropped():
    a = applicant()
    a["household_members"] = [{"first_name": f"P{i}", "id": f"m{i}"} for i in range(12)]
    a["incomes"] = [{"individual_name": f"X{i}"} for i in range(6)]
    fields = build_snap_fields(a)
    assert "household_members__7__first_name" in fields and "household_members__8__first_name" not in fields
    assert "incomes__2__individual_name" in fields and "incomes__3__individual_name" not in fields


@pytest.mark.parametrize("raw,expected", [
    ("123 Fake St, Queens, NY 11101", {"street": "123 Fake St", "city": "Queens", "zip": "11101"}),
    ("45 Main St Apt 3B, Brooklyn, New York 11201-1234", {"street": "45 Main St", "apt": "3B", "city": "Brooklyn", "zip": "11201"}),
    ("somewhere vague", {"street": "somewhere vague"}),
    (None, {}),
])
def test_split_address(raw, expected):
    assert _split_address(raw) == expected


def post(body):
    return client.post("/api/forms", json=body)


def test_route_returns_base64_pdf():
    r = post({"applicant": wrap(applicant()), "benefits": ["SNAP"]})
    assert r.status_code == 200
    forms = r.json()["forms"]
    assert [f["name"] for f in forms] == ["LDSS-4826"]
    assert base64.b64decode(forms[0]["pdf"]).startswith(b"%PDF")


@pytest.mark.parametrize("body,detail", [
    ({"applicant": {"a": 1}}, "No benefits to create forms for."),
    ({"applicant": {"a": 1}, "benefits": []}, "No benefits to create forms for."),
    ({"applicant": {"a": 1}, "benefits": ["SNAP", "Fair Fares"]}, "Unknown benefit."),
    ({"benefits": ["SNAP"]}, "No information to fill the forms."),
    ({"applicant": {"a": {"value": None, "source": None}}, "benefits": ["SNAP"]}, "No information to fill the forms."),
])
def test_route_bad_requests(body, detail):
    r = post(body)
    assert r.status_code == 400 and r.json()["detail"] == detail


def test_route_failure_is_generic(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("Jane Testperson 123 Fake St")
    monkeypatch.setattr("app.routes.forms.fill_form", boom)
    r = post({"applicant": wrap(applicant()), "benefits": ["SNAP"]})
    assert r.status_code == 500 and r.json()["detail"] == "Couldn't create your forms, try again."
    assert "Jane" not in r.text


def test_logs_contain_no_applicant_data(caplog):
    with caplog.at_level(logging.DEBUG):
        assert post({"applicant": wrap(applicant()), "benefits": ["SNAP"]}).status_code == 200
    text = caplog.text
    assert "event=forms_generated | benefit=SNAP" in text
    assert "Jane" not in text and "Fake St" not in text and "JVBER" not in text
