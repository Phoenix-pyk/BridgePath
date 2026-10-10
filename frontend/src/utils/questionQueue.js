// frontend/src/utils/questionQueue.js
//
// Read side of the questions step: which QuestionBank entries still need
// asking, in what order, and how each one is worded. Pure functions of
// `applicant` (see applicantModel.js), so the queue is simply rebuilt after
// every answer. The bank's format is described in CLAUDE.md.

import QUESTION_BANK from "../data/QuestionBank.json";
import { isAnswered } from "./applicantModel.js";

export { QUESTION_BANK };

export const SECTION_LABELS = {
    basics: "About your application",
    roster: "Your household",
    person: "About each person",
    household: "Your household",
    income: "Income",
    resources: "Money and property",
    housing: "Housing",
    expenses: "Expenses",
    legal: "Required legal questions",
    final: "Last few questions",
};

// Row scopes: where their rows live in `applicant`
export const ROW_ARRAYS = {
    income: ["incomes"],
    asset: ["assets"],
    child_support: ["household", "child_support_payments"],
};

export function getIn(obj, path) {
    return path.reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

export function splitPath(path) {
    return path.split(".");
}

export function getRows(applicant, scope) {
    return getIn(applicant, ROW_ARRAYS[scope]) || [];
}

export function ageOf(member, today = new Date()) {
    const dob = member?.dob?.value;
    if (!dob) return null;
    const born = new Date(dob + "T00:00:00");
    if (Number.isNaN(born.getTime())) return null;
    let age = today.getFullYear() - born.getFullYear();
    const m = today.getMonth() - born.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age -= 1;
    return age;
}

// ctx = { applicant, member?, row? }
function resolveField(path, ctx) {
    const [head, ...rest] = splitPath(path);
    if (head === "member") return getIn(ctx.member, rest);
    if (head === "row") return getIn(ctx.row, rest);
    return getIn(ctx.applicant, splitPath(path));
}

export function evalCond(cond, ctx) {
    if (cond == null) return true;
    if (cond.all) return cond.all.every((c) => evalCond(c, ctx));
    if (cond.any) return cond.any.some((c) => evalCond(c, ctx));
    if (cond.not) return !evalCond(cond.not, ctx);
    if (cond.age) {
        // Unknown age: ask rather than silently skip
        const age = ageOf(ctx.member);
        if (age === null) return true;
        return (cond.age.min == null || age >= cond.age.min) && (cond.age.max == null || age <= cond.age.max);
    }
    if (cond.isEmpty) {
        const arr = getIn(ctx.applicant, splitPath(cond.isEmpty));
        return !Array.isArray(arr) || arr.length === 0;
    }
    if (cond.field) {
        const value = resolveField(cond.field, ctx)?.value;
        if ("equals" in cond) return value === cond.equals;
        if ("in" in cond) return cond.in.includes(value);
        if ("gt" in cond) return typeof value === "number" && value > cond.gt;
        if ("includesAny" in cond) return Array.isArray(value) && value.some((v) => cond.includesAny.includes(v));
    }
    return false;
}

// A checklist's items that apply here (each item may have its own askIf).
// ctx = { applicant, member? }
export function checklistItems(entry, ctx) {
    return entry.items.filter((item) => evalCond(item.askIf, ctx));
}

// Where a checklist's item paths start: the member for member scope, else the applicant root
export function checklistBase(entry, ctx) {
    return entry.scope === "member" ? ctx.member : ctx.applicant;
}

function checklistItemAnswered(item, base) {
    const target = getIn(base, splitPath(item.path));
    return item.who ? isAnswered(target?.answer) : isAnswered(target);
}

// Everything that can add rows (a yes/no entry with addRows, or a checklist
// item with addRows), by id: the entry's qid, or the item's own `id`.
export const ROW_SOURCES = {};
for (const [qid, entry] of Object.entries(QUESTION_BANK)) {
    if (entry.addRows) ROW_SOURCES[qid] = { path: entry.path, addRows: entry.addRows, rowTypes: entry.rowTypes };
    for (const item of entry.items || []) {
        if (item.addRows) ROW_SOURCES[item.id] = { path: item.path, addRows: item.addRows, rowTypes: item.rowTypes };
    }
}

// Members a whoFlag question is about (e.g. everyone 16+)
export function whoFlagMembers(applicant, entry) {
    return applicant.household_members.filter((m) => evalCond(entry.memberAskIf, { applicant, member: m }));
}

function needsAnswer(entry, target, applicant, member) {
    if (entry.input === "checklist") {
        const ctx = { applicant, member };
        const base = checklistBase(entry, ctx);
        return checklistItems(entry, ctx).some((item) => !checklistItemAnswered(item, base));
    }
    if (entry.input === "who") return !isAnswered(target?.answer);
    if (entry.input === "whoFlag") {
        return whoFlagMembers(applicant, entry).some((m) => !isAnswered(m[entry.path]));
    }
    return !isAnswered(target);
}

export function itemKey(item) {
    return item.kind === "addAnother" ? `addAnother:${item.qid}` : `${item.qid}:${item.memberId ?? item.rowId ?? ""}`;
}

// Every item, answered or not, in asking order (the question screen's pages). Each section's entries
// are split into runs of the same scope; a member/row run loops people/rows
// on the outside so one person's (or one income's) questions stay together.
export function listItems(applicant, { doneAdding = new Set() } = {}) {
    const sections = [];
    for (const [qid, entry] of Object.entries(QUESTION_BANK)) {
        let section = sections[sections.length - 1];
        if (!section || section.name !== entry.section) {
            section = { name: entry.section, runs: [] };
            sections.push(section);
        }
        let run = section.runs[section.runs.length - 1];
        if (!run || run.scope !== entry.scope) {
            run = { scope: entry.scope, entries: [] };
            section.runs.push(run);
        }
        run.entries.push([qid, entry]);
    }

    const items = [];
    for (const section of sections) {
        for (const run of section.runs) {
            if (run.scope === "household") {
                for (const [qid, entry] of run.entries) {
                    if (!evalCond(entry.askIf, { applicant })) continue;
                    const target = entry.path ? getIn(applicant, splitPath(entry.path)) : null;
                    items.push({ kind: "question", qid, scope: "household", section: section.name,
                        answered: !needsAnswer(entry, target, applicant) });
                }
            } else if (run.scope === "member") {
                for (const member of applicant.household_members) {
                    for (const [qid, entry] of run.entries) {
                        if (!evalCond(entry.askIf, { applicant, member })) continue;
                        if (entry.input === "checklist" && checklistItems(entry, { applicant, member }).length === 0) continue;
                        items.push({ kind: "question", qid, scope: "member", memberId: member.id, section: section.name,
                            answered: !needsAnswer(entry, entry.path ? getIn(member, splitPath(entry.path)) : null, applicant, member) });
                    }
                }
            } else {
                for (const row of getRows(applicant, run.scope)) {
                    for (const [qid, entry] of run.entries) {
                        if (!evalCond(entry.askIf, { applicant, row })) continue;
                        items.push({ kind: "question", qid, scope: run.scope, rowId: row.id, section: section.name,
                            answered: !needsAnswer(entry, getIn(row, splitPath(entry.path)), applicant) });
                    }
                }
                // After the rows: "add another?" for each row source answered yes
                for (const [sourceId, source] of Object.entries(ROW_SOURCES)) {
                    if (source.addRows !== run.scope || doneAdding.has(sourceId)) continue;
                    if (getIn(applicant, splitPath(source.path))?.value !== true) continue;
                    items.push({ kind: "addAnother", qid: sourceId, scope: run.scope, section: section.name, answered: false });
                }
            }
        }
    }
    return items;
}

// Which page (index into listItems) the question screen shows, or -1 for the
// end page. view is one of:
//   { type: "page", key, index }      the user jumped to (or went Back to) an item
//   { type: "next", from, lastKey }   just answered/skipped the item at `from`: show the next
//                                     unanswered item from there, wrapping to earlier ones
//   { type: "end" }
// An answer can insert items at `from` (e.g. "add another" adds a row before
// itself), so `from` itself counts unless it's still the item just answered.
export function pickPage(items, view, skipped = new Set()) {
    if (view.type === "end") return -1;
    if (view.type === "page") {
        const idx = items.findIndex((i) => itemKey(i) === view.key);
        if (idx !== -1) return idx;
        view = { type: "next", from: view.index, lastKey: view.key };
    }
    const pending = (i) => !i.answered && !skipped.has(itemKey(i));
    for (let j = view.from; j < items.length; j++) {
        if (pending(items[j]) && !(j === view.from && itemKey(items[j]) === view.lastKey)) return j;
    }
    for (let j = 0; j < Math.min(view.from, items.length); j++) {
        if (pending(items[j])) return j;
    }
    return -1;
}

// What's left to ask. `skipped` holds itemKeys the user put off ("Skip for
// now"); `doneAdding` holds addRows question ids the user finished adding to.
export function buildQueue(applicant, { skipped = new Set(), doneAdding = new Set() } = {}) {
    return listItems(applicant, { doneAdding }).filter((item) => !item.answered && !skipped.has(itemKey(item)));
}

// Eligibility's `missing` items name fields by path, e.g. "household_members[].dob",
// "incomes[].frequency", "household.lives_in_new_york". Find the bank entry that asks it.
const PATH_SCOPES = { "household_members[]": "member", "incomes[]": "income", "assets[]": "asset" };

// Returns { qid, entry, item? }; `item` is set when the path is one line of a checklist.
export function findQuestionForPath(itemPath) {
    const [head, ...rest] = itemPath.split(".");
    const scope = PATH_SCOPES[head] ?? "household";
    const path = scope === "household" ? itemPath : rest.join(".");
    for (const [qid, entry] of Object.entries(QUESTION_BANK)) {
        if (entry.scope !== scope) continue;
        if (entry.path === path) return { qid, entry };
        const item = (entry.items || []).find((i) => i.path === path);
        if (item) return { qid, entry, item };
    }
    // Member facts asked once for the whole household (pregnancy, work limits)
    if (scope === "member") {
        for (const [qid, entry] of Object.entries(QUESTION_BANK)) {
            if (entry.input === "whoFlag" && entry.path === path) return { qid, entry };
        }
    }
    return null;
}

export function findMember(applicant, id) {
    return applicant.household_members.find((m) => m.id === id);
}

export function findRow(applicant, scope, id) {
    return getRows(applicant, scope).find((r) => r.id === id);
}

export function memberLabel(member) {
    if (!member) return "this person";
    const first = member.first_name?.value;
    if (member.is_applicant?.value === true) return first ? `You (${first})` : "You";
    return first ? [first, member.last_name?.value].filter(Boolean).join(" ") : "Unnamed person";
}

// Fill {name}. For the applicant, turn "Is {name} ..." into "Are you ..." etc.
export function questionText(entry, member) {
    if (!member) return entry.question;
    if (member.is_applicant?.value === true) {
        if (entry.questionSelf) return entry.questionSelf;
        return entry.question
            .replace(/^Is \{name\}/, "Are you")
            .replace(/^Does \{name\}/, "Do you")
            .replace(/^Has \{name\}/, "Have you")
            .replace(/^Was \{name\}/, "Were you")
            .replaceAll("{name}'s", "your")
            .replaceAll("{name}", "you");
    }
    const first = member.first_name?.value;
    return entry.question.replaceAll("{name}", first || "this person");
}
