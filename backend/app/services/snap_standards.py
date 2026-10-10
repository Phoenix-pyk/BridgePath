"""
SNAP eligibility standards (federal fiscal year 2027: Oct 1, 2026 - Sep 30, 2027), 48 states + DC.

Constants only; no logic beyond small lookups. Update this one file each October. This project
screens eligibility; it does not compute benefit amounts, so no allotment/deduction tables live here.

Provenance, per group:
  CONFIRMED  - read on an official page (NYS OTDA SNAP page, otda.ny.gov/programs/snap/)
  DERIVED    - computed from CONFIRMED values and checked against them
  UNVERIFIED - not confirmed against an official page; re-check before relying on it
"""
import math

FISCAL_YEAR = 2027

# DERIVED: 2026 HHS poverty guidelines (48 states + DC). Reproduces OTDA's published gross
# limits exactly (HH1 $1,729, HH2 $2,345, HH3 $2,960, HH4 $3,575) when rounded up.
FPL_ANNUAL_FIRST_PERSON = 15_960
FPL_ANNUAL_EACH_ADDITIONAL = 5_680

# CONFIRMED (OTDA): gross income test tiers, as a share of the federal poverty level.
GROSS_PCT_STANDARD = 1.30            # no earned income, no elderly/disabled member, no dependent care
GROSS_PCT_EARNED_INCOME = 1.50       # has earned income, no elderly/disabled member, no dependent care
GROSS_PCT_ELDERLY_DISABLED_OR_CARE = 2.00  # elderly/disabled member, or pays dependent care

# Federal age rules used by the screening.
ELDERLY_AGE = 60
ABAWD_MIN_AGE = 18
ABAWD_MAX_AGE = 64

# Immigration categories that can receive SNAP after the 2025 federal changes (H.R. 1):
# citizens, lawful permanent residents, Cuban/Haitian entrants, COFA citizens.
# UNVERIFIED against an official page; kept here so it is a one-line change.
ELIGIBLE_CITIZEN_STATUSES = {
    "us_citizen",
    "lawful_permanent_resident",
    "cuban_haitian_entrant",
    "cofa_citizen",
}

# Weekly/biweekly/semi-monthly/monthly pay -> monthly multiplier.
MONTHLY_FACTOR = {
    "weekly": 52 / 12,
    "biweekly": 26 / 12,
    "semi_monthly": 2,
    "monthly": 1,
}


def poverty_level_monthly(household_size: int) -> float:
    annual = FPL_ANNUAL_FIRST_PERSON + FPL_ANNUAL_EACH_ADDITIONAL * (household_size - 1)
    return annual / 12


def income_limit(household_size: int, pct: float) -> int:
    """Monthly income limit at `pct` of FPL, rounded up to the next dollar like OTDA's charts."""
    return math.ceil(poverty_level_monthly(household_size) * pct - 1e-9)
