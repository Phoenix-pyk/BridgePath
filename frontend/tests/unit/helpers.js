// Shared helpers for the unit tests: build households and drive the
// questionnaire the same way QuestionScreen does (listItems + pickPage).

import { QUESTION_BANK, itemKey, listItems, pickPage } from "../../src/utils/questionQueue.js";
import { addRow, applyAnswer } from "../../src/utils/applicantEdits.js";

// A date of birth `years` ago (so ages stay the same whenever the tests run)
export function dobYearsAgo(years) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    d.setMonth(0, 15);
    return d.toISOString().slice(0, 10);
}

// A plain answer for any question type, used when a test doesn't care
export function defaultAnswer(entry) {
    switch (entry.input) {
        case "yesno": return false;
        case "select": return entry.options[0].value;
        case "multiselect": return [entry.options[0].value];
        case "who": return { answer: false, who: [] };
        case "whoFlag": return [];
        case "checklist": return { checked: [], who: {} };
        case "list": return [];
        case "members": return [];
        case "number": return 1;
        case "money": return 0;
        case "date": return dobYearsAgo(30);
        default: return entry.skipValue !== undefined ? entry.skipValue : "x";
    }
}

// Answers every page until the questionnaire is done.
//   answer(item, entry, applicant) → value, or undefined for defaultAnswer
//   addAnother(item, applicant) → true to add another row
// Returns { applicant, seen: [labels], doneAdding }. Labels look like
// "dob@1" (member index), "incomeMember#1" (row index), "addAnother:hasVehicles".
export function runQuestionnaire(applicant, { answer = () => undefined, addAnother = () => false, maxSteps = 400 } = {}) {
    let a = applicant;
    const doneAdding = new Set();
    const seen = [];
    let view = { type: "next", from: 0, lastKey: null };
    for (let step = 0; step < maxSteps; step++) {
        const items = listItems(a, { doneAdding });
        const index = pickPage(items, view);
        if (index === -1) return { applicant: a, seen, doneAdding };
        const item = items[index];
        view = { type: "next", from: index, lastKey: itemKey(item) };
        seen.push(label(a, item));

        if (item.kind === "addAnother") {
            if (addAnother(item, a)) a = addRow(a, item.qid);
            else doneAdding.add(item.qid);
            continue;
        }
        const entry = QUESTION_BANK[item.qid];
        const value = answer(item, entry, a);
        a = applyAnswer(a, item, value === undefined ? defaultAnswer(entry) : value);
    }
    throw new Error("questionnaire did not finish");
}

function label(a, item) {
    if (item.kind === "addAnother") return `addAnother:${item.qid}`;
    if (item.memberId) return `${item.qid}@${a.household_members.findIndex((m) => m.id === item.memberId)}`;
    if (item.rowId) {
        const rows = item.scope === "income" ? a.incomes : item.scope === "asset" ? a.assets : a.household.child_support_payments;
        return `${item.qid}#${rows.findIndex((r) => r.id === item.rowId)}`;
    }
    return item.qid;
}

// True if every {value, source} leaf has exactly those two keys (the backend contract)
export function leavesAreWrapped(node) {
    if (node && typeof node === "object" && "value" in node && "source" in node) {
        return Object.keys(node).sort().join() === "source,value";
    }
    if (node && typeof node === "object") return Object.values(node).every(leavesAreWrapped);
    return true;
}
