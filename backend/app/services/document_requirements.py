"""
Static reference data mapping NYS public assistance eligibility factors to the
documents that can prove them, transcribed from the official "Documentation
Requirements" table in PUB-1301 (Instructions for Completing the New York State
Application for Public Assistance / SNAP / Medicaid / Services, Rev. 7/23, pages 18-19).

Not consumed by any route yet. Intended for a future feature that aggregates
multiple /extract results into one applicant profile and, for each eligibility
factor still missing, suggests which document types to upload next.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DocumentRequirement:
    factor: str
    label: str
    acceptable_documents: list[str] = field(default_factory=list)
    related_fields: list[str] = field(default_factory=list)
    notes: str | None = None


DOCUMENT_REQUIREMENTS: list[DocumentRequirement] = [
    DocumentRequirement(
        factor="social_security_number",
        label="Social Security Number",
        acceptable_documents=["Social Security card", "Official correspondence from SSA"],
        related_fields=["household_members[].ssn"],
        notes=(
            "Not required for Public Assistance, SNAP, or Medicaid-only unless the SSN given does not match "
            "SSA records. Not required for non-citizens seeking emergency-only Medicaid or pregnant "
            "Medicaid-only applicants."
        ),
    ),
    DocumentRequirement(
        factor="citizenship_or_noncitizen_status",
        label="Citizenship or Current Non-Citizen Status",
        acceptable_documents=[
            "Birth certificate", "Baptismal certificate", "Hospital records", "U.S. passport",
            "Military service records", "Naturalization certificate", "USCIS documentation",
            "Evidence of continuous U.S. residence since prior to 1/1/72",
        ],
        related_fields=["household_members[].citizen_status"],
        notes="Non-citizens must have satisfactory immigration status to be eligible for PA, SNAP, or Medicaid.",
    ),
    DocumentRequirement(
        factor="identity",
        label="Identity",
        acceptable_documents=[
            "Photo I.D.", "Driver license", "U.S. passport", "Naturalization certificate",
            "Hospital/doctor's records", "Adoption paper", "Statement from another person",
            "Validated Social Security number", "Birth/baptismal certificate",
        ],
        related_fields=["household_members[].first_name", "household_members[].last_name"],
    ),
    DocumentRequirement(
        factor="earned_income_employer",
        label="Earned Income (from employer)",
        acceptable_documents=[
            "Current wage stubs", "Pay envelopes",
            "Letterhead statement with rate of pay per hour, hours worked per week, date of first pay, employer's phone number",
            "Contact with employer",
        ],
        related_fields=["incomes[].gross_amount", "incomes[].employer_or_source_name", "incomes[].income_type=wages"],
    ),
    DocumentRequirement(
        factor="earned_income_self_employment",
        label="Earned Income (from self-employment)",
        acceptable_documents=["Business records", "Tax records", "Records of self-employment earnings and expenses"],
        related_fields=["incomes[].income_type=self_employment"],
    ),
    DocumentRequirement(
        factor="income_from_rent_or_room_board",
        label="Income from Rent or Room/Board",
        acceptable_documents=["Current income tax return", "Current contribution check", "Statement from roomer, boarder, tenant", "Income tax records"],
        related_fields=["incomes[].income_type=rental_roomer_boarder"],
    ),
    DocumentRequirement(
        factor="marital_status",
        label="Marital Status",
        acceptable_documents=[
            "Marriage/death certificates", "Separation agreement", "Divorce decree",
            "Social Security records", "VA records", "Statement from clergy", "Census records",
            "Newspaper notice", "Statement from another person",
        ],
        related_fields=["household_members[].marital_status"],
    ),
    DocumentRequirement(
        factor="residence",
        label="Residence",
        acceptable_documents=[
            "Statement from landlord", "Current rent receipt or lease", "Mortgage records",
            "Statement from another person", "Current mail", "School records",
        ],
        related_fields=["primary_address", "shelter.landlord_name"],
    ),
    DocumentRequirement(
        factor="household_composition",
        label="Household Composition/Size",
        acceptable_documents=["Statement from non-relative landlord", "School records", "Statements from other persons"],
        related_fields=["household_members"],
    ),
    DocumentRequirement(
        factor="age",
        label="Age",
        acceptable_documents=[
            "Birth certificate", "Baptismal certificate", "Hospital records", "Adoption records",
            "Naturalization certificate", "Driver license", "Insurance policy", "Census records",
            "School records", "Statement from another person", "Physician statement",
            "Official correspondence from SSA",
        ],
        related_fields=["household_members[].dob"],
    ),
    DocumentRequirement(
        factor="unearned_income_child_support",
        label="Unearned Income: Child Support (received)",
        acceptable_documents=["Statement from Family Court", "Statement from person paying support", "Check stubs"],
        related_fields=["incomes[].income_type=child_support_received"],
    ),
    DocumentRequirement(
        factor="unearned_income_uib",
        label="Unearned Income: Unemployment Insurance Benefits",
        acceptable_documents=["Current award certificate", "Current benefit check", "Official correspondence with NYS Dept. of Labor"],
        related_fields=["incomes[].income_type=unemployment_insurance"],
    ),
    DocumentRequirement(
        factor="unearned_income_social_security",
        label="Unearned Income: Social Security Benefits (including SSI)",
        acceptable_documents=["Current award certificate", "Current benefit check", "Official correspondence from SSA"],
        related_fields=["incomes[].income_type=social_security", "incomes[].income_type=ssi"],
    ),
    DocumentRequirement(
        factor="unearned_income_veterans_benefits",
        label="Unearned Income: Veteran's Benefits",
        acceptable_documents=["Current award certificate", "Current benefit check", "Official correspondence from VA"],
        related_fields=["incomes[].income_type=veterans_benefits"],
    ),
    DocumentRequirement(
        factor="unearned_income_workers_compensation",
        label="Unearned Income: Workers' Compensation",
        acceptable_documents=["Award letter", "Check stub"],
        related_fields=["incomes[].income_type=workers_compensation"],
    ),
    DocumentRequirement(
        factor="unearned_income_education_grants",
        label="Unearned Income: Education Grants and Loans",
        acceptable_documents=["Statement from school", "Statement from bank", "Award letter"],
        related_fields=["incomes[].income_type=educational_assistance"],
    ),
    DocumentRequirement(
        factor="unearned_income_interest_dividends",
        label="Unearned Income: Interest/Dividends/Royalties",
        acceptable_documents=["Statement from bank or credit union", "Statement from broker/agent"],
        related_fields=["incomes[].income_type=other"],
    ),
    DocumentRequirement(
        factor="unearned_income_private_pension",
        label="Unearned Income: Private Pension/Annuity",
        acceptable_documents=["Current award letter", "Current benefit check", "Official correspondence from source of income"],
        related_fields=["incomes[].income_type=pension_retirement"],
    ),
    DocumentRequirement(
        factor="absent_parent",
        label="Absent Parent",
        acceptable_documents=[
            "Death certificate", "Survivor's benefits", "Hospital records", "VA or military records",
            "Divorce papers", "Proof of remarriage", "Newspaper notice", "Insurance company records",
            "Institutional records", "Agency case records and burial payment files", "Statement from another person",
        ],
        related_fields=[],
        notes="Required when the parent of a child in the home is not living with the household.",
    ),
    DocumentRequirement(
        factor="absent_parent_information",
        label="Absent Parent Information (name, address, SSN, birth date, employment)",
        acceptable_documents=["Pay stubs", "Tax returns", "Social Security or VA records", "Monetary determination letters", "ID cards (health insurance)", "Driver license or registration"],
        related_fields=[],
    ),
    DocumentRequirement(
        factor="shelter_expenses",
        label="Shelter Expenses",
        acceptable_documents=[
            "Current rent receipt", "Current lease", "Mortgage book/records", "Property and school tax records",
            "Landlord statement", "Sewer and water bills", "Homeowner's insurance records", "Fuel bills",
            "Non-heating utility bills", "Telephone bills",
        ],
        related_fields=["shelter.rent_or_mortgage_amount", "shelter.property_taxes_annual", "shelter.homeowners_insurance_annual", "shelter.utilities"],
        notes="Medicaid does not require documentation of shelter expenses. Separate documentation may be needed per expense item.",
    ),
    DocumentRequirement(
        factor="medical_bills",
        label="Medical Bills",
        acceptable_documents=["Copies of medical bills (paid and unpaid)"],
        related_fields=[],
    ),
    DocumentRequirement(
        factor="health_insurance",
        label="Health Insurance",
        acceptable_documents=["Insurance policy", "Insurance card", "Statement from provider of coverage", "Medicare card"],
        related_fields=[],
    ),
    DocumentRequirement(
        factor="resources_bank_accounts",
        label="Resources: Bank Accounts (checking, savings, retirement - IRA/Keogh)",
        acceptable_documents=["Current bank records", "Current credit union records"],
        related_fields=["assets[].resource_type=checking", "assets[].resource_type=savings", "assets[].resource_type=retirement_account"],
    ),
    DocumentRequirement(
        factor="resources_stocks_bonds",
        label="Resources: Stocks, Bonds, Certificates",
        acceptable_documents=["Stock certificate", "Bonds", "Statement from financial institution"],
        related_fields=["assets[].resource_type=stocks_bonds"],
    ),
    DocumentRequirement(
        factor="resources_life_insurance",
        label="Resources: Life Insurance",
        acceptable_documents=["Insurance policy", "Statement from insurance company"],
        related_fields=["assets[].resource_type=life_insurance"],
    ),
    DocumentRequirement(
        factor="resources_burial_trust",
        label="Resources: Burial Trust or Fund, Burial Plot or Funeral Agreement",
        acceptable_documents=["Bank records", "Burial agreement", "Burial plot deed", "Statement from funeral director"],
        related_fields=["assets[].resource_type=burial_trust_or_fund"],
    ),
    DocumentRequirement(
        factor="resources_real_estate",
        label="Resources: Real Estate Other Than Residence",
        acceptable_documents=["Deed", "Statement from real estate broker", "Appraisal/estimate of current value by broker"],
        related_fields=["assets[].resource_type=real_estate_other_than_residence"],
    ),
    DocumentRequirement(
        factor="resources_motor_vehicle",
        label="Resources: Motor Vehicle",
        acceptable_documents=["Registration (older models)", "Title of ownership", "Appraisal of current value by dealer", "Financing data"],
        related_fields=["assets[].resource_type=vehicle", "assets[].vehicle_year", "assets[].vehicle_make_model"],
    ),
    DocumentRequirement(
        factor="resources_lump_sum",
        label="Resources: Lump Sum Payment",
        acceptable_documents=["Statement from source of payment"],
        related_fields=["assets[].resource_type=lump_sum_payment"],
    ),
    DocumentRequirement(
        factor="disabled_incapacitated_pregnant",
        label="Disabled/Incapacitated/Pregnant",
        acceptable_documents=[
            "Statement from medical professional verifying pregnancy and expected date of birth",
            "Statement from medical professional", "Proof of SSA or SSI benefits for disability or blindness",
        ],
        related_fields=["household_members[].is_pregnant", "household_members[].pregnancy_due_date", "household_members[].has_work_limiting_condition"],
    ),
    DocumentRequirement(
        factor="unpaid_bills",
        label="Unpaid Bills (rent, utility)",
        acceptable_documents=["Copy of each bill showing amount owed, period of service, and provider"],
        related_fields=[],
    ),
    DocumentRequirement(
        factor="school_attendance",
        label="School Attendance",
        acceptable_documents=["School records (current report card)", "Statement from school or higher education institution"],
        related_fields=["household_members[].is_student", "household_members[].highest_grade_completed"],
    ),
    DocumentRequirement(
        factor="other_expenses_dependent_care",
        label="Other Expenses/Dependent Care Cost (court-ordered support, child care, recurring loans, home health aide)",
        acceptable_documents=["Court order", "Statement from day care center or other child care provider", "Statement from aide or attendant", "Cancelled checks or receipts"],
        related_fields=[],
    ),
]
