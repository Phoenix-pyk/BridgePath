import logging

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routes import eligibility as route
from app.services import snap_standards as std
from app.services.eligibility_rules import normalize_citizen_status
from tests.applicant_fixture import make, wrap

client = TestClient(app)
URL = "/api/eligibility"


def check(plain, mutate_wrapped=None):
    wrapped = wrap(plain)
    if mutate_wrapped:
        mutate_wrapped(wrapped)
    r = client.post(URL, json={"applicant": wrapped})
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert len(results) == 1 and results[0]["benefit"] == "SNAP"
    return results[0]


# ------------------------------------------------------------ happy path & contract

def test_full_applicant_is_eligible():
    res = check(make())
    assert res["status"] == "eligible"
    assert res["missing"] == []
    assert res["estimatedAmount"] is None   # benefit amounts are intentionally not predicted


def test_response_shape_is_locked():
    res = check(make())
    assert set(res) == {"benefit", "status", "reason", "estimatedAmount", "missing"}
    assert res["status"] in {"eligible", "needs_something", "not_eligible"}


# ------------------------------------------------------------ not_eligible

def test_income_over_gross_limit():
    p = make()
    p["incomes"][0]["gross_amount"] = 6000.0
    res = check(p)
    assert res["status"] == "not_eligible" and res["estimatedAmount"] is None and res["missing"] == []


def test_not_new_york_resident():
    p = make()
    p["household"]["lives_in_new_york"] = False
    assert check(p)["status"] == "not_eligible"


def test_receiving_snap_elsewhere():
    p = make()
    p["household"]["receives_snap_elsewhere"] = True
    assert check(p)["status"] == "not_eligible"


def test_nobody_has_eligible_immigration_status():
    p = make()
    for m in p["household_members"]:
        m["citizen_status"] = "other_noncitizen"
    assert check(p)["status"] == "not_eligible"


def test_student_without_exemption_is_excluded_from_unit():
    p = make()
    p["household_members"][0].update(is_student=True, meets_student_exemption=False)
    res = check(p)
    # applicant dropped, only the child remains: HH1, income 2816 > 200% HH1 limit (2660)
    assert res["status"] == "not_eligible"


# ------------------------------------------------------------ needs_something

def test_user_claimed_income_needs_document_with_member_index():
    def tag_user(w):
        w["incomes"][0]["gross_amount"]["source"] = "user"
    res = check(make(), tag_user)
    assert res["status"] == "needs_something"
    assert {"type": "document", "item": "earned_income_employer", "memberIndex": 0} in res["missing"]
    assert res["estimatedAmount"] is None


def test_missing_dob_asks_question_for_that_member():
    p = make()
    p["household_members"][1]["dob"] = None
    res = check(p)
    assert res["status"] == "needs_something" and res["estimatedAmount"] is None
    assert {"type": "question", "item": "household_members[].dob", "memberIndex": 1} in res["missing"]


def test_no_household_members():
    p = make()
    p["household_members"] = []
    res = check(p)
    assert res["status"] == "needs_something"
    assert {"type": "question", "item": "household_members", "memberIndex": None} in res["missing"]


def test_missing_household_answers():
    p = make()
    p["household"] = {k: None for k in p["household"]}
    items = {m["item"] for m in check(p)["missing"]}
    assert {"household.lives_in_new_york", "household.dependent_care_monthly"} <= items
    assert not any("rent" in i or "child_support" in i or "medical" in i for i in items)


def test_disability_question_only_when_it_could_change_the_tier():
    p = make()
    p["household"]["dependent_care_monthly"] = 0.0           # drops the 200% care tier
    p["incomes"][0]["gross_amount"] = 1400.0                 # 3033/mo: over 150% (2705), under 200% (3607)
    p["household_members"][0]["receives_disability_benefits"] = None
    res = check(p)
    assert res["status"] == "needs_something"
    assert {"type": "question", "item": "household_members[].receives_disability_benefits",
            "memberIndex": 0} in res["missing"]


# ------------------------------------------------------------ calculations

def _single_adult(frequency, amount, care=0.0):
    p = make()
    p["household_members"] = [p["household_members"][0]]
    p["incomes"][0].update(gross_amount=amount, frequency=frequency)
    p["household"]["dependent_care_monthly"] = care
    return p


@pytest.mark.parametrize("frequency,amount,expected", [
    # HH1 earned-income limit is $1,995/mo
    ("weekly", 450.0, "eligible"),         # 450*52/12 = 1950
    ("weekly", 470.0, "not_eligible"),     # 470*52/12 = 2036.7
    ("biweekly", 900.0, "eligible"),       # 900*26/12 = 1950
    ("biweekly", 950.0, "not_eligible"),   # 950*26/12 = 2058.3
    ("semi_monthly", 990.0, "eligible"),   # 1980
    ("semi_monthly", 1010.0, "not_eligible"),  # 2020
    ("monthly", 1995.0, "eligible"),       # exactly at the limit passes
    ("monthly", 1996.0, "not_eligible"),
])
def test_frequency_conversion_against_gross_limit(frequency, amount, expected):
    assert check(_single_adult(frequency, amount))["status"] == expected


def test_dependent_care_unlocks_the_200_percent_tier():
    assert check(_single_adult("monthly", 2500.0))["status"] == "not_eligible"
    assert check(_single_adult("monthly", 2500.0, care=100.0))["status"] == "eligible"


def test_unearned_income_uses_the_130_percent_tier():
    p = _single_adult("monthly", 1800.0)
    p["incomes"][0]["income_type"] = "unemployment_insurance"   # not earned: limit is $1,729
    assert check(p)["status"] == "not_eligible"
    p["incomes"][0]["gross_amount"] = 1700.0
    assert check(p)["status"] == "eligible"


@pytest.mark.parametrize("size,pct,expected", [
    (1, 1.3, 1729), (2, 1.3, 2345), (3, 1.3, 2960), (4, 1.3, 3575),   # OTDA chart (CONFIRMED)
    (1, 1.5, 1995), (1, 2.0, 2660),                                    # OTDA tiers (CONFIRMED)
    (4, 1.0, 2750),
])
def test_income_limits_match_otda_charts(size, pct, expected):
    assert std.income_limit(size, pct) == expected


@pytest.mark.parametrize("raw,expected", [
    ("US Citizen", "us_citizen"), ("U.S. citizen", "us_citizen"), ("us_citizen", "us_citizen"),
    ("Lawful Permanent Resident", "lawful_permanent_resident"), ("Green card", "lawful_permanent_resident"),
    ("Qualified Alien", "other_noncitizen"), ("Non-citizen", "other_noncitizen"),
    ("Cuban entrant", "cuban_haitian_entrant"), ("", None), (None, None), ("banana", None),
])
def test_normalize_citizen_status(raw, expected):
    assert normalize_citizen_status(raw) == expected


# ------------------------------------------------------------ route behaviour

def test_split_values_and_sources():
    values, sources = route.split_values_and_sources(wrap(make()))
    assert values["household_members"][0]["first_name"] == "Jane"
    assert sources["household_members"][0]["first_name"] == "document"
    assert sources["household_members"][0]["citizen_status"] == "user"
    assert sources["household"]["lives_in_new_york"] == "user"
    assert values["household_members"][0]["other_names"] == []


@pytest.mark.parametrize("body", [
    {}, {"applicant": None}, {"applicant": {}}, {"applicant": "Jane"}, {"applicant": ["x"]}, [],
    {"applicant": {"household_members": [], "incomes": [], "shelter": {"value": None, "source": "user"}}},
])
def test_no_information_is_400(body):
    r = client.post(URL, json=body)
    assert r.status_code == 400 and r.json() == {"detail": "No information to check."}


def test_malformed_json_is_400_and_not_echoed():
    r = client.post(URL, content=b'{"applicant": {"secret": ', headers={"content-type": "application/json"})
    assert r.status_code == 400
    assert "secret" not in r.text


def test_rules_failure_is_generic_500(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("Jane Testperson 123-45-6789")
    monkeypatch.setattr(route, "evaluate", boom)
    r = client.post(URL, json={"applicant": wrap(make())})
    assert r.status_code == 500
    assert r.json() == {"detail": "Something went wrong, try again."}
    assert "Jane" not in r.text


def test_logs_contain_only_benefit_and_status(caplog):
    with caplog.at_level(logging.DEBUG):
        client.post(URL, json={"applicant": wrap(make())})
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "event=eligibility_checked" in text and "benefit=SNAP" in text and "status=eligible" in text
    for secret in ("Jane", "Testperson", "Leo", "1300", "123 Fake", "ACME", "1800"):
        assert secret not in text, secret
