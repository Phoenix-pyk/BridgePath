// frontend/src/utils/mergeExtraction.js
//
// Accumulates one upload's extracted fields (plain values from /api/extract)
// into BridgeContext's `applicant` (every leaf { value, source }, see
// applicantModel.js). Extracted values are tagged source "document".
//
// Only empty fields are ever filled, so an earlier document's value, and
// anything the user answered, is never overwritten. The applicant (row 1) is
// the one person expected across documents (ID, lease, paystub), so their
// record is fill-null merged. Every other person, income and asset is a new
// row tagged with the upload's id; removeUploads() drops those rows again
// when a document is re-uploaded in the "fixing" flow. No fuzzy
// name-matching of non-applicant people across documents.

import {
  ASSET_DOCUMENT_KEYS, INCOME_DOCUMENT_KEYS, MEMBER_DOCUMENT_KEYS, SHELTER_DOCUMENT_KEYS,
  UTILITY_DOCUMENT_KEYS, field, isAnswered, makeAsset, makeIncome, makeMember, makeUtility,
} from "./applicantModel.js";

function isEmptyValue(v) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

// Fill each empty field in `target` from the plain `incoming` object
function fillEmpty(target, incoming, keys) {
  const next = { ...target };
  for (const key of keys) {
    if (!isAnswered(next[key]) && !isEmptyValue(incoming?.[key])) {
      next[key] = field(incoming[key], "document");
    }
  }
  return next;
}

function normName(first, last) {
  return `${first ?? ""}${last ?? ""}`.toLowerCase().replace(/[^a-z]/g, "");
}

function findMemberId(members, individualName) {
  if (isEmptyValue(individualName)) return null;
  const target = normName(individualName, "");
  const match = members.find(
    (m) => normName(m.first_name.value, m.last_name.value) === target && target !== ""
  );
  return match ? match.id : null;
}

// Fill one existing person's empty fields from a document's person
function fillPerson(member, incoming, keys = MEMBER_DOCUMENT_KEYS) {
  const merged = fillEmpty(member, incoming, keys);
  // other_names is a list: union document names in rather than only filling when empty
  const names = [...new Set([...(member.other_names.value || []), ...(incoming.other_names || [])])];
  if (names.length > (member.other_names.value || []).length) {
    merged.other_names = field(names, member.other_names.source ?? "document");
  }
  return merged;
}

// Fixing a specific person (e.g. uploading Leo's birth certificate for his
// missing date of birth): the document's person fills that member instead of
// becoming a new row, and nobody else on the document is added.
function mergeIntoTarget(members, incomingMembers, targetMemberId) {
  const idx = members.findIndex((m) => m.id === targetMemberId);
  const people = incomingMembers || [];
  if (idx === -1 || people.length === 0) return members;
  const target = members[idx];
  const targetName = normName(target.first_name.value, target.last_name.value);
  const incoming =
    people.find((p) => targetName && normName(p.first_name, p.last_name) === targetName) ??
    (target.is_applicant.value === true ? people.find((p) => p.is_applicant) : null) ??
    (people.length === 1 ? people[0] : people.find((p) => !p.is_applicant) ?? people[0]);
  // Don't let a document's "Self" / applicant flag describe someone else
  const keys = target.is_applicant.value === true
    ? MEMBER_DOCUMENT_KEYS
    : MEMBER_DOCUMENT_KEYS.filter((k) => k !== "is_applicant" && k !== "relationship_to_applicant");
  const next = [...members];
  next[idx] = fillPerson(target, incoming, keys);
  return next;
}

function mergeMembers(members, incomingMembers, uploadId) {
  const next = [...members];
  for (const incoming of incomingMembers || []) {
    if (incoming.is_applicant) {
      const idx = next.findIndex((m) => m.is_applicant.value === true);
      if (idx === -1) {
        next.unshift(fillEmpty(makeMember({ is_applicant: field(true, "user") }), incoming, MEMBER_DOCUMENT_KEYS));
        continue;
      }
      next[idx] = fillPerson(next[idx], incoming);
    } else {
      // makeMember's is_applicant (false) counts as answered, so it isn't overwritten
      next.push(fillEmpty(makeMember({ _upload_id: uploadId }), incoming, MEMBER_DOCUMENT_KEYS));
    }
  }
  return next;
}

function mergeShelter(shelter, incoming) {
  if (!incoming) return shelter;
  const next = fillEmpty(shelter, incoming, SHELTER_DOCUMENT_KEYS);
  const utilities = [...shelter.utilities];
  for (const u of incoming.utilities || []) {
    const idx = utilities.findIndex((existing) => existing.utility_type.value === u.utility_type);
    if (idx === -1) utilities.push(fillEmpty(makeUtility(), u, UTILITY_DOCUMENT_KEYS));
    else utilities[idx] = fillEmpty(utilities[idx], u, UTILITY_DOCUMENT_KEYS);
  }
  next.utilities = utilities;
  return next;
}

// targetMemberId (optional): the upload is for this person (see mergeIntoTarget)
export function mergeExtraction(applicant, fields, uploadId, { targetMemberId = null } = {}) {
  const top = fillEmpty(applicant, fields, ["primary_address", "mailing_address"]);
  const household_members = targetMemberId
    ? mergeIntoTarget(applicant.household_members, fields.household_members, targetMemberId)
    : mergeMembers(applicant.household_members, fields.household_members, uploadId);

  const incomes = [
    ...applicant.incomes,
    ...(fields.incomes || []).map((inc) => {
      const row = fillEmpty(makeIncome({ _upload_id: uploadId }), inc, INCOME_DOCUMENT_KEYS);
      const memberId = findMemberId(household_members, inc.individual_name) ?? targetMemberId;
      if (memberId) row.member_id = field(memberId, "document");
      return row;
    }),
  ];

  const assets = [
    ...applicant.assets,
    ...(fields.assets || []).map((a) => fillEmpty(makeAsset({ _upload_id: uploadId }), a, ASSET_DOCUMENT_KEYS)),
  ];

  return {
    ...top,
    household_members,
    incomes,
    assets,
    shelter: mergeShelter(applicant.shelter, fields.shelter),
  };
}

// Proof upload for income the user typed in: once the document's income is in,
// drop the typed rows of the same kind for that person so it isn't counted twice.
export function replaceTypedIncomes(applicant, uploadId, memberId) {
  const added = applicant.incomes.filter((r) => r._upload_id === uploadId && r.member_id.value === memberId);
  if (added.length === 0) return applicant;
  const types = new Set(added.map((r) => r.income_type.value));
  return {
    ...applicant,
    incomes: applicant.incomes.filter((r) =>
      !(r._upload_id === null && r.member_id.value === memberId && r.gross_amount.source === "user" &&
        (types.has(r.income_type.value) || r.income_type.value === null))
    ),
  };
}

// Drop the people, incomes and assets that came from these uploads. Values
// already filled into the applicant's own record, the address or shelter
// stay, since they can't be told apart from other documents' values.
export function removeUploads(applicant, uploadIds) {
  const ids = new Set(uploadIds);
  if (ids.size === 0) return applicant;
  const keep = (row) => !ids.has(row._upload_id);
  const household_members = applicant.household_members.filter(keep);
  const memberIds = new Set(household_members.map((m) => m.id));
  // Unlink rows that pointed at a removed person
  const unlink = (row) => (row.member_id.value && !memberIds.has(row.member_id.value) ? { ...row, member_id: field() } : row);
  return {
    ...applicant,
    household_members,
    incomes: applicant.incomes.filter(keep).map(unlink),
    assets: applicant.assets.filter(keep).map(unlink),
  };
}
