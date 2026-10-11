from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field


class Frequency(str, Enum):
    WEEKLY = "weekly"
    BIWEEKLY = "biweekly"
    MONTHLY = "monthly"
    SEMI_MONTHLY = "semi_monthly"


class UtilityType(str, Enum):
    HEATING_PRIMARY = "heating_primary"
    ELECTRIC_LIGHTING = "electric_lighting"
    COOKING_GAS = "cooking_gas"
    WATER_SEWER = "water_sewer"
    TRASH = "trash"


class IncomeType(str, Enum):
    WAGES = "wages"
    SELF_EMPLOYMENT = "self_employment"
    SSI = "ssi"
    SOCIAL_SECURITY = "social_security"
    VETERANS_BENEFITS = "veterans_benefits"
    UNEMPLOYMENT_INSURANCE = "unemployment_insurance"
    WORKERS_COMPENSATION = "workers_compensation"
    CHILD_SUPPORT_RECEIVED = "child_support_received"
    FOSTER_CARE_MAINTENANCE = "foster_care_maintenance"
    PENSION_RETIREMENT = "pension_retirement"
    EDUCATIONAL_ASSISTANCE = "educational_assistance"
    ALIMONY = "alimony"
    RENTAL_ROOMER_BOARDER = "rental_roomer_boarder"
    OTHER = "other"


class ResourceType(str, Enum):
    CHECKING = "checking"
    SAVINGS = "savings"
    RETIREMENT_ACCOUNT = "retirement_account"
    STOCKS_BONDS = "stocks_bonds"
    LIFE_INSURANCE = "life_insurance"
    BURIAL_TRUST_OR_FUND = "burial_trust_or_fund"
    VEHICLE = "vehicle"
    REAL_ESTATE_OTHER_THAN_RESIDENCE = "real_estate_other_than_residence"
    LUMP_SUM_PAYMENT = "lump_sum_payment"
    OTHER = "other"


class DocumentType(str, Enum):
    # Identity
    ID = "id"
    BIRTH_CERTIFICATE = "birth_certificate"
    SOCIAL_SECURITY_CARD = "social_security_card"
    IMMIGRATION_DOCUMENT = "immigration_document"
    # Income
    PAY_STUB = "pay_stub"
    EMPLOYER_LETTER = "employer_letter"
    SOCIAL_SECURITY_AWARD_LETTER = "social_security_award_letter"
    UNEMPLOYMENT_LETTER = "unemployment_letter"
    VETERANS_BENEFITS_LETTER = "veterans_benefits_letter"
    WORKERS_COMP_LETTER = "workers_comp_letter"
    PENSION_LETTER = "pension_letter"
    CHILD_SUPPORT_RECORD = "child_support_record"
    AID_LETTER = "aid_letter"
    TAX_RETURN = "tax_return"
    # Housing
    LEASE = "lease"
    MORTGAGE_STATEMENT = "mortgage_statement"
    UTILITY_BILL = "utility_bill"
    PROPERTY_TAX_BILL = "property_tax_bill"
    HOMEOWNERS_INSURANCE = "homeowners_insurance"
    # Resources
    BANK_STATEMENT = "bank_statement"
    INVESTMENT_STATEMENT = "investment_statement"
    LIFE_INSURANCE_POLICY = "life_insurance_policy"
    VEHICLE_DOCUMENT = "vehicle_document"
    # Other
    MEDICAL_STATEMENT = "medical_statement"
    SCHOOL_RECORD = "school_record"
    OTHER = "other"


class Individual(BaseModel):
    first_name: Optional[str] = Field(None, description="First name")
    last_name: Optional[str] = Field(None, description="Last name")
    dob: Optional[str] = Field(None, description="Format: YYYY-MM-DD")
    ssn: Optional[str] = Field(None, description="Social Security Number if visible")
    is_applicant: Optional[bool] = Field(False)
    relationship_to_applicant: Optional[str] = Field(None, description="e.g., Spouse, Child, Self")
    is_student: Optional[bool] = Field(None, description="Enrolled in college or higher education")
    citizen_status: Optional[str] = Field(None, description="US Citizen, Qualified Alien, etc.")
    sex: Optional[str] = Field(None, description="M, F, or X, as printed on an ID or benefit correspondence")
    marital_status: Optional[str] = Field(
        None, description="Single, Married, Widowed, Separated, or Divorced, if shown on a marriage/death certificate or divorce decree"
    )
    highest_grade_completed: Optional[str] = Field(None, description="From a school record or transcript")
    is_pregnant: Optional[bool] = Field(None, description="From a medical professional's statement")
    pregnancy_due_date: Optional[str] = Field(None, description="From a medical professional's statement")
    has_work_limiting_condition: Optional[bool] = Field(
        None, description="Whether a medical professional's statement describes a condition limiting ability to work"
    )
    is_veteran: Optional[bool] = Field(None, description="From military service records or VA correspondence")
    other_names: Optional[List[str]] = Field(
        default_factory=list, description="Maiden or other names, if visible on any document"
    )


class IncomeSource(BaseModel):
    individual_name: Optional[str] = Field(None, description="Whose income this is")
    employer_or_source_name: Optional[str] = Field(None, description="Name of employer or agency")
    income_type: Optional[IncomeType] = Field(None, description="Category of income matching the state application's own income taxonomy")
    gross_amount: Optional[float] = Field(None, description="Gross pay amount before deductions")
    frequency: Optional[Frequency] = Field(None)
    hours_worked_per_month: Optional[float] = Field(
        None, description="Hours worked per month, matching both LDSS-2921 and LDSS-4826's 'Hours Worked Monthly' fields"
    )
    pay_day_of_week: Optional[str] = Field(None, description="Day of the week paid, if printed on a paystub")
    employment_type: Optional[str] = Field(None, description="'employed' or 'self-employed', as implied by the source document")


class UtilityDetail(BaseModel):
    utility_type: UtilityType
    is_included_in_rent: Optional[bool] = Field(None)
    monthly_cost: Optional[float] = Field(None)


class ShelterCosts(BaseModel):
    rent_or_mortgage_amount: Optional[float] = Field(None)
    frequency: Optional[Frequency] = Field(Frequency.MONTHLY)
    landlord_name: Optional[str] = Field(None)
    landlord_phone: Optional[str] = Field(None)
    utilities: Optional[List[UtilityDetail]] = Field(default_factory=list)
    property_taxes_annual: Optional[float] = Field(
        None, description="Annual property tax amount, as shown on a property tax bill/assessment"
    )
    homeowners_insurance_annual: Optional[float] = Field(
        None, description="Annual homeowner's insurance premium, matching LDSS-4826's 'Insurance on home per year' field, as shown on an insurance policy/declarations page"
    )
    lease_start_date: Optional[str] = Field(None, description="From a lease agreement, format: YYYY-MM-DD")


class Resource(BaseModel):
    resource_type: Optional[ResourceType] = Field(None, description="Checking, Savings, Vehicle, etc.")
    amount: Optional[float] = Field(None, description="Dollar amount or value of the resource")
    vehicle_year: Optional[str] = Field(None, description="Only for resource_type=vehicle")
    vehicle_make_model: Optional[str] = Field(None, description="Only for resource_type=vehicle")


class BridgePathExtractionPayload(BaseModel):
    doc_type_detected: DocumentType = Field(
        ...,
        description="Detected document type. Use 'other' only if the document matches none of the listed types."
    )
    primary_address: Optional[str] = Field(None, description="Full residential address")
    mailing_address: Optional[str] = Field(None)
    household_members: Optional[List[Individual]] = Field(default_factory=list)
    incomes: Optional[List[IncomeSource]] = Field(default_factory=list)
    shelter: Optional[ShelterCosts] = Field(None)
    assets: Optional[List[Resource]] = Field(default_factory=list)
    issues_or_missing_info: Optional[List[str]] = Field(
        default_factory=list,
        description="List any required details that appear blurred, cut off, incomplete, or ambiguous."
    )
