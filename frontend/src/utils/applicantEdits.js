// frontend/src/utils/applicantEdits.js
//
// Write side of the questions step: every change the roster and question
// screens make to `applicant` goes through here, immutably, and is tagged
// source "user".

import { field, makeAsset, makeChildSupportPayment, makeIncome, makeMember } from "./applicantModel.js";
import {
    QUESTION_BANK, ROW_ARRAYS, ROW_SOURCES, checklistItems, getIn, splitPath, whoFlagMembers,
} from "./questionQueue.js";

// Immutable set at a path of keys / array indexes
function setIn(obj, path, value) {
    if (path.length === 0) return value;
    const [key, ...rest] = path;
    const copy = Array.isArray(obj) ? [...obj] : { ...obj };
    copy[key] = setIn(obj[key], rest, value);
    return copy;
}

function updateIn(obj, path, fn) {
    return setIn(obj, path, fn(getIn(obj, path)));
}

// Base path of the person or row an item is about
function basePath(applicant, item) {
    if (item.scope === "member") {
        return ["household_members", applicant.household_members.findIndex((m) => m.id === item.memberId)];
    }
    if (ROW_ARRAYS[item.scope]) {
        const arrayPath = ROW_ARRAYS[item.scope];
        return [...arrayPath, getIn(applicant, arrayPath).findIndex((r) => r.id === item.rowId)];
    }
    return [];
}

function fullName(member) {
    return [member.first_name.value, member.last_name.value].filter(Boolean).join(" ");
}

function newRow(source, sourceId) {
    const scope = source.addRows;
    const tags = { _added_by: sourceId };
    if (scope === "income") return makeIncome(tags);
    if (scope === "child_support") return makeChildSupportPayment(tags);
    const types = source.rowTypes || null;
    return makeAsset({
        ...tags,
        _row_types: types,  // limits the "What kind is it?" options
        ...(types && types.length === 1 ? { resource_type: field(types[0], "user") } : {}),
    });
}

// sourceId: a ROW_SOURCES id (the addRows question's qid, or a checklist item's id)
export function addRow(applicant, sourceId) {
    const source = ROW_SOURCES[sourceId];
    return updateIn(applicant, ROW_ARRAYS[source.addRows], (rows) => [...rows, newRow(source, sourceId)]);
}

function removeRowsAddedBy(applicant, sourceId) {
    const source = ROW_SOURCES[sourceId];
    return updateIn(applicant, ROW_ARRAYS[source.addRows], (rows) => rows.filter((r) => r._added_by !== sourceId));
}

// A yes on a row source adds its first row; a no removes the rows it added
function syncRows(applicant, sourceId, yes) {
    const rows = getIn(applicant, ROW_ARRAYS[ROW_SOURCES[sourceId].addRows]);
    const hasOwnRows = rows.some((r) => r._added_by === sourceId);
    if (yes && !hasOwnRows) return addRow(applicant, sourceId);
    if (!yes) return removeRowsAddedBy(applicant, sourceId);
    return applicant;
}

// has_snap_disqualification comes from the six legal "who" questions:
// true if anyone named them, false once all six are answered without them.
export function syncDerived(applicant) {
    const legal = Object.values(applicant.legal);
    const allAnswered = legal.every((q) => q.answer.value !== null);
    const named = new Set(legal.filter((q) => q.answer.value === true).flatMap((q) => q.who.value || []));
    return {
        ...applicant,
        household_members: applicant.household_members.map((m) => {
            const value = named.has(m.id) ? true : allAnswered ? false : null;
            if (m.has_snap_disqualification.value === value) return m;
            return { ...m, has_snap_disqualification: field(value, value === null ? null : "user") };
        }),
    };
}

// Save one answer. `value` depends on the input type:
//   who → { answer: bool, who: [memberIds] };  whoFlag → [memberIds];
//   checklist → { checked: [itemPaths], who: { itemPath: [memberIds] } };
//   everything else → the plain value (or the entry's skipValue).
export function applyAnswer(applicant, item, value) {
    const entry = QUESTION_BANK[item.qid];
    let next = applicant;

    if (entry.input === "checklist") {
        const base = basePath(next, item);
        const member = item.scope === "member" ? getIn(next, base) : undefined;
        const checked = new Set(value.checked);
        for (const line of checklistItems(entry, { applicant: next, member })) {
            const yes = checked.has(line.path);
            const target = [...base, ...splitPath(line.path)];
            if (line.who) {
                next = setIn(next, target, {
                    answer: field(yes, "user"),
                    who: field(yes ? value.who?.[line.path] || [] : [], "user"),
                });
            } else {
                next = setIn(next, target, field(yes ? (line.checked ?? true) : (line.unchecked ?? false), "user"));
            }
            if (line.addRows) next = syncRows(next, line.id, yes);
        }
        return syncDerived(next);
    }

    if (entry.input === "whoFlag") {
        const chosen = new Set(value);
        const eligible = new Set(whoFlagMembers(applicant, entry).map((m) => m.id));
        next = {
            ...next,
            household_members: next.household_members.map((m) =>
                eligible.has(m.id) ? { ...m, [entry.path]: field(chosen.has(m.id), "user") } : m
            ),
        };
        return syncDerived(next);
    }

    const target = [...basePath(next, item), ...splitPath(entry.path)];
    if (entry.input === "who") {
        next = setIn(next, target, {
            answer: field(value.answer, "user"),
            who: field(value.answer ? value.who : [], "user"),
        });
    } else {
        next = setIn(next, target, field(value, "user"));
    }

    // Eligibility matches income to people by name, so keep it in sync
    if (item.scope === "income" && entry.path === "member_id") {
        const member = next.household_members.find((m) => m.id === value);
        if (member) next = setIn(next, [...basePath(next, item), "individual_name"], field(fullName(member), "user"));
    }

    for (const [path, fixed] of Object.entries(entry.alsoSet || {})) {
        next = setIn(next, splitPath(path), field(fixed, "user"));
    }

    if (entry.addRows) next = syncRows(next, item.qid, value === true);

    return syncDerived(next);
}

export function addPerson(applicant, firstName, lastName) {
    const person = makeMember({
        roster_confirmed: true,
        first_name: field(firstName.trim() || null, firstName.trim() ? "user" : null),
        last_name: field(lastName.trim() || null, lastName.trim() ? "user" : null),
    });
    return { ...applicant, household_members: [...applicant.household_members, person] };
}

// Remove a person (never the applicant) and every reference to them
export function removePerson(applicant, memberId) {
    const unlink = (row) => (row.member_id.value === memberId ? { ...row, member_id: field() } : row);
    const dropId = (f) => (Array.isArray(f.value) && f.value.includes(memberId) ? { ...f, value: f.value.filter((id) => id !== memberId) } : f);
    const dropFromWho = (q) => ({ ...q, who: dropId(q.who) });
    return syncDerived({
        ...applicant,
        household_members: applicant.household_members.filter((m) => m.id !== memberId || m.is_applicant.value === true),
        incomes: applicant.incomes.map(unlink),
        assets: applicant.assets.map(unlink),
        household: {
            ...applicant.household,
            on_strike: dropFromWho(applicant.household.on_strike),
            dependent_care_who: dropId(applicant.household.dependent_care_who),
            child_support_payments: applicant.household.child_support_payments.map(unlink),
        },
        legal: Object.fromEntries(Object.entries(applicant.legal).map(([k, q]) => [k, dropFromWho(q)])),
    });
}

export function confirmRoster(applicant) {
    return {
        ...applicant,
        household_members: applicant.household_members.map((m) => ({ ...m, roster_confirmed: true })),
    };
}
