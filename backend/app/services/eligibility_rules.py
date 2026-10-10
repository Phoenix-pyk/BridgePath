"""
SNAP eligibility screening for the LDSS-4826 flow.

Pure functions only: no I/O, no logging. Callers pass two parallel trees with the applicant's shape:
`values` (plain facts) and `sources` ("document" | "user" | None per leaf). Nothing here prints or
stores applicant data.

This is a preliminary screening, not a determination: the local office decides. It decides eligibility
only (gross income tier test plus household facts); it does NOT predict a benefit amount. Numeric
standards live in snap_standards.py.

Result shape (locked with the frontend):
    {benefit, status, reason, estimatedAmount, missing: [{type, item, memberIndex}]}
`estimatedAmount` is reserved for contract compatibility and is always None.
`missing[].item` is a document factor (see document_requirements.py) when type == "document", or an
applicant path with `[]` for repeating rows (e.g. "household_members[].dob") when type == "question";
`memberIndex` is the household_members[] row (None for household-level items). For
"incomes[].*" questions it is the matched member's row, or None if the income couldn't be matched.
"""
import re
from datetime import date
from typing import Any, Optional

from app.services import snap_standards as std

BENEFIT = "SNAP"
ELIGIBLE = "eligible"
NEEDS_SOMETHING = "needs_something"
NOT_ELIGIBLE = "not_eligible"

EARNED_INCOME_TYPES = {"wages", "self_employment"}

# income_type -> PUB-1301 documentation factor (document_requirements.py)
INCOME_DOCUMENT_FACTOR = {
    "wages": "earned_income_employer",
    "self_employment": "earned_income_self_employment",
    "social_security": "unearned_income_social_security",
    "ssi": "unearned_income_social_security",
    "veterans_benefits": "unearned_income_veterans_benefits",
    "unemployment_insurance": "unearned_income_uib",
    "workers_compensation": "unearned_income_workers_compensation",
    "child_support_received": "unearned_income_child_support",
    "pension_retirement": "unearned_income_private_pension",
    "educational_assistance": "unearned_income_education_grants",
    "rental_roomer_boarder": "income_from_rent_or_room_board",
}


# ---------------------------------------------------------------- small helpers

def _dig(tree: Any, *path) -> Any:
    """Safe nested lookup; returns None if any step is missing or the wrong type."""
    cur = tree
    for step in path:
        if isinstance(step, int):
            if not isinstance(cur, list) or step >= len(cur):
                return None
        elif not isinstance(cur, dict):
            return None
        cur = cur[step] if isinstance(step, int) else cur.get(step)
        if cur is None:
            return None
    return cur


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _bool(v: Any) -> Optional[bool]:
    return v if isinstance(v, bool) else None


def _norm_name(first: Any, last: Any) -> str:
    return re.sub(r"[^a-z]", "", f"{first or ''}{last or ''}".lower())


def _age(dob: Any, today: date) -> Optional[int]:
    try:
        born = date.fromisoformat(str(dob))
    except ValueError:
        return None
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def normalize_citizen_status(raw: Any) -> Optional[str]:
    """Map free-text or canonical immigration status to a canonical value, or None if unrecognised."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    s = re.sub(r"[^a-z]+", " ", raw.lower()).strip()
    canonical = std.ELIGIBLE_CITIZEN_STATUSES | {"other_noncitizen"}
    if s.replace(" ", "_") in canonical:
        return s.replace(" ", "_")
    if "cofa" in s or "free association" in s:
        return "cofa_citizen"
    if "cuban" in s or "haitian" in s:
        return "cuban_haitian_entrant"
    if "permanent resident" in s or "green card" in s or s == "lpr":
        return "lawful_permanent_resident"
    if "non citizen" in s or "noncitizen" in s or "undocumented" in s or "not a citizen" in s:
        return "other_noncitizen"
    if any(w in s for w in ("refugee", "asylee", "asylum", "visa", "qualified", "daca", "alien", "parole", "tps")):
        return "other_noncitizen"
    if "citizen" in s:
        return "us_citizen"
    return None


class _Missing:
    """Collects de-duplicated `missing` items."""

    def __init__(self) -> None:
        self._items: list[dict] = []

    def add(self, type_: str, item: str, member_index: Optional[int] = None) -> None:
        entry = {"type": type_, "item": item, "memberIndex": member_index}
        if entry not in self._items:
            self._items.append(entry)

    def questions(self) -> list[dict]:
        return [m for m in self._items if m["type"] == "question"]

    def documents(self) -> list[dict]:
        return [m for m in self._items if m["type"] == "document"]

    def all(self) -> list[dict]:
        return list(self._items)


def _result(status: str, reason: str, missing: Optional[list] = None) -> dict:
    return {
        "benefit": BENEFIT,
        "status": status,
        "reason": reason,
        "estimatedAmount": None,  # reserved by the response contract; benefit amounts are not predicted
        "missing": missing or [],
    }


# ---------------------------------------------------------------- SNAP

def evaluate(values: dict, sources: dict, today: Optional[date] = None) -> list[dict]:
    """Entry point: returns the list of per-benefit results (SNAP only for now)."""
    return [evaluate_snap(values, sources, today or date.today())]


def evaluate_snap(values: dict, sources: dict, today: date) -> dict:
    missing = _Missing()

    # --- Hard disqualifiers that no further answer can change -------------------------------
    if _dig(values, "household", "lives_in_new_york") is False:
        return _result(NOT_ELIGIBLE, "SNAP through this tool is for New York State residents.")
    if _dig(values, "household", "receives_snap_elsewhere") is True:
        return _result(NOT_ELIGIBLE, "A household can't receive SNAP in two places at once.")
    if _dig(values, "household", "lives_in_new_york") is None:
        missing.add("question", "household.lives_in_new_york")

    # --- Household members -------------------------------------------------------------------
    members = _dig(values, "household_members")
    members = members if isinstance(members, list) else []
    if not members:
        missing.add("question", "household_members")

    info = []  # one dict per member row
    for i, m in enumerate(members):
        m = m if isinstance(m, dict) else {}
        age = _age(m.get("dob"), today) if m.get("dob") else None
        if age is None:
            missing.add("question", "household_members[].dob", i)

        status = normalize_citizen_status(m.get("citizen_status"))
        if status is None:
            missing.add("question", "household_members[].citizen_status", i)

        shares_food = m.get("buys_and_prepares_with_household")
        if shares_food is None:
            shares_food = True if (i == 0 or len(members) == 1) else None
            if shares_food is None:
                missing.add("question", "household_members[].buys_and_prepares_with_household", i)

        student_ok = True
        if age is not None and 18 <= age <= 49:
            if m.get("is_student") is None:
                missing.add("question", "household_members[].is_student", i)
            elif m.get("is_student") is True:
                exempt = _bool(m.get("meets_student_exemption"))
                if exempt is None:
                    missing.add("question", "household_members[].meets_student_exemption", i)
                student_ok = bool(exempt)

        info.append({
            "name": _norm_name(m.get("first_name"), m.get("last_name")),
            "age": age,
            "status_ok": status in std.ELIGIBLE_CITIZEN_STATUSES,
            "shares_food": shares_food is not False,
            "disqualified": m.get("has_snap_disqualification") is True,
            "student_ok": student_ok,
            "disability": _bool(m.get("receives_disability_benefits")),
        })

    for row in info:
        row["in_unit"] = (
            row["shares_food"] and row["status_ok"] and row["student_ok"] and not row["disqualified"]
        )
    unit = [r for r in info if r["in_unit"]]
    size = len(unit)

    if members and not missing.questions() and size == 0:
        return _result(NOT_ELIGIBLE, "No one in this household appears able to receive SNAP based on the answers given.")

    elderly_or_disabled = any(
        (r["age"] is not None and r["age"] >= std.ELDERLY_AGE) or r["disability"] is True for r in unit
    )

    # --- Income ------------------------------------------------------------------------------
    incomes = _dig(values, "incomes")
    incomes = incomes if isinstance(incomes, list) else []
    if not incomes and _dig(values, "household", "has_income") is None:
        missing.add("question", "household.has_income")

    name_to_row = {r["name"]: i for i, r in enumerate(info) if r["name"]}
    earned = 0.0
    unearned = 0.0
    for j, inc in enumerate(incomes):
        inc = inc if isinstance(inc, dict) else {}
        who = name_to_row.get(_norm_name(inc.get("individual_name"), ""))
        if who is not None and not info[who]["shares_food"]:
            continue  # someone who buys/prepares food separately isn't part of this unit's income
        amount, freq = _num(inc.get("gross_amount")), inc.get("frequency")
        if amount is None:
            missing.add("question", "incomes[].gross_amount", who)
            continue
        if freq not in std.MONTHLY_FACTOR:
            missing.add("question", "incomes[].frequency", who)
            continue
        kind = inc.get("income_type")
        if kind is None:
            missing.add("question", "incomes[].income_type", who)
            continue
        monthly = amount * std.MONTHLY_FACTOR[freq]
        if kind in EARNED_INCOME_TYPES:
            earned += monthly
        else:
            unearned += monthly

        if _dig(sources, "incomes", j, "gross_amount") == "user":
            factor = INCOME_DOCUMENT_FACTOR.get(kind)
            if factor:
                missing.add("document", factor, who)

    # Paying for dependent care moves the household to the highest (200%) gross income tier.
    dependent_care = _num(_dig(values, "household", "dependent_care_monthly"))
    if dependent_care is None:
        missing.add("question", "household.dependent_care_monthly")

    # --- Decide whether the disability answer is worth asking for (only if it could change the tier)
    gross = earned + unearned
    if size and not missing.questions():
        std_pct = std.GROSS_PCT_EARNED_INCOME if earned > 0 else std.GROSS_PCT_STANDARD
        passes_std = gross <= std.income_limit(size, std_pct)
        passes_top = gross <= std.income_limit(size, std.GROSS_PCT_ELDERLY_DISABLED_OR_CARE)
        if not passes_std and passes_top and not elderly_or_disabled and not (dependent_care or 0) > 0:
            for i, r in enumerate(info):
                if r["in_unit"] and r["disability"] is None and (r["age"] or 0) < std.ELDERLY_AGE:
                    missing.add("question", "household_members[].receives_disability_benefits", i)

    if missing.questions():
        return _result(
            NEEDS_SOMETHING,
            "We need a few more answers before we can check SNAP eligibility.",
            missing.all(),
        )

    # --- Gross income test -------------------------------------------------------------------
    care_tier = elderly_or_disabled or (dependent_care or 0) > 0
    if care_tier:
        pct = std.GROSS_PCT_ELDERLY_DISABLED_OR_CARE
    elif earned > 0:
        pct = std.GROSS_PCT_EARNED_INCOME
    else:
        pct = std.GROSS_PCT_STANDARD
    if gross > std.income_limit(size, pct):
        return _result(
            NOT_ELIGIBLE,
            f"Your household's gross monthly income appears to be over the SNAP limit for a household of {size}.",
        )

    if missing.documents():
        return _result(
            NEEDS_SOMETHING,
            "Your household looks like it may qualify for SNAP, but some answers need a supporting document.",
            missing.all(),
        )
    return _result(
        ELIGIBLE,
        "Based on your answers, your household appears to qualify for SNAP. "
        "The local office makes the final decision.",
    )
