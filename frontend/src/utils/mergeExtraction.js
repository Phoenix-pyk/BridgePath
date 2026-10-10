// frontend/src/utils/mergeExtraction.js
//
// Accumulates one document's extracted fields into the household profile
// (BridgeContext's `applicant`). The applicant's own record is the one
// person guaranteed to reappear across documents (their ID, lease, paystub),
// so it's found-or-created and fill-null merged. Everything else is tagged
// with which document produced it and appended; re-uploading that same
// document type (the "fixing" flow) replaces only its own prior
// contributions, mirroring the replace-by-type pattern intakeUpload.jsx
// already uses for `documents`. No fuzzy name-matching across documents.

function isEmpty(v) {
  return v === null || v === undefined || v === "";
}

function fillNullMerge(existing, incoming, keys) {
  const next = { ...existing };
  for (const key of keys) {
    if (isEmpty(next[key]) && !isEmpty(incoming[key])) next[key] = incoming[key];
  }
  return next;
}

const MEMBER_KEYS = [
  "first_name", "last_name", "dob", "ssn", "is_applicant", "relationship_to_applicant",
  "is_student", "citizen_status", "sex", "marital_status", "highest_grade_completed",
  "is_pregnant", "pregnancy_due_date", "has_work_limiting_condition", "is_veteran",
];

function mergeMembers(existingMembers, incomingMembers, documentType) {
  // Keep the applicant's record regardless of source; drop this document
  // type's own previous non-applicant contributions (handles re-upload).
  let next = existingMembers.filter(
    (m) => m.is_applicant || m._source_document_type !== documentType
  );
  for (const incoming of incomingMembers || []) {
    if (incoming.is_applicant) {
      const idx = next.findIndex((m) => m.is_applicant);
      if (idx === -1) {
        next.push({ other_names: [], ...incoming });
      } else {
        next[idx] = fillNullMerge(next[idx], incoming, MEMBER_KEYS);
        next[idx].other_names = [
          ...new Set([...(next[idx].other_names || []), ...(incoming.other_names || [])]),
        ];
      }
    } else {
      next.push({ other_names: [], ...incoming, _source_document_type: documentType });
    }
  }
  return next;
}

function mergeIncomes(existingIncomes, incomingIncomes, documentType) {
  const kept = existingIncomes.filter((i) => i._source_document_type !== documentType);
  const added = (incomingIncomes || []).map((i) => ({ ...i, _source_document_type: documentType }));
  return [...kept, ...added];
}

const SHELTER_KEYS = [
  "rent_or_mortgage_amount", "frequency", "landlord_name", "landlord_phone",
  "property_taxes_annual", "homeowners_insurance_annual", "lease_start_date",
];

function mergeUtilities(existingUtilities, incomingUtilities) {
  const next = [...(existingUtilities || [])];
  for (const incoming of incomingUtilities || []) {
    const matchIndex = next.findIndex((u) => u.utility_type === incoming.utility_type);
    if (matchIndex === -1) next.push(incoming);
    else next[matchIndex] = fillNullMerge(next[matchIndex], incoming, ["is_included_in_rent", "monthly_cost"]);
  }
  return next;
}

function mergeShelter(existingShelter, incomingShelter) {
  if (!incomingShelter) return existingShelter;
  if (!existingShelter) return { utilities: [], ...incomingShelter };
  return {
    ...fillNullMerge(existingShelter, incomingShelter, SHELTER_KEYS),
    utilities: mergeUtilities(existingShelter.utilities, incomingShelter.utilities),
  };
}

function mergeAssets(existingAssets, incomingAssets, documentType) {
  const kept = existingAssets.filter((a) => a._source_document_type !== documentType);
  const added = (incomingAssets || []).map((a) => ({ ...a, _source_document_type: documentType }));
  return [...kept, ...added];
}

export function mergeExtraction(applicant, fields, documentType) {
  const top = fillNullMerge(
    { primary_address: applicant.primary_address, mailing_address: applicant.mailing_address },
    { primary_address: fields.primary_address ?? null, mailing_address: fields.mailing_address ?? null },
    ["primary_address", "mailing_address"]
  );
  return {
    ...top,
    household_members: mergeMembers(applicant.household_members, fields.household_members, documentType),
    incomes: mergeIncomes(applicant.incomes, fields.incomes, documentType),
    shelter: mergeShelter(applicant.shelter, fields.shelter),
    assets: mergeAssets(applicant.assets, fields.assets, documentType),
    extra: applicant.extra,
  };
}
