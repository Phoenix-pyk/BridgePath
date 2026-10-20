// QuestionBank.json is data, so check it against the applicant model: every
// path exists in the right scope, every condition uses the askIf grammar, and
// every select has options. Catches typos before they become silent bugs.

import { describe, expect, it } from "vitest";
import QUESTION_BANK from "../../src/data/QuestionBank.json";
import {
    makeAsset, makeChildSupportPayment, makeEmptyApplicant, makeIncome, makeMember,
} from "../../src/utils/applicantModel.js";

const app = makeEmptyApplicant();
const ROOTS = { household: app, member: makeMember(), income: makeIncome(), asset: makeAsset(), child_support: makeChildSupportPayment() };
const ROW_SCOPES = ["income", "asset", "child_support"];
const SECTIONS = ["basics", "roster", "person", "household", "income", "resources", "housing", "expenses", "legal", "final"];
const INPUTS = ["checklist", "whoFlag", "text", "longtext", "date", "number", "money", "phone", "ssn", "address",
    "yesno", "select", "multiselect", "list", "member", "members", "who"];

const get = (obj, path) => path.split(".").reduce((cur, k) => (cur == null ? undefined : cur[k]), obj);
const isField = (f) => f != null && typeof f === "object" && "value" in f && "source" in f;
const isWho = (f) => f != null && isField(f.answer) && isField(f.who);

function conditionErrors(cond, scope) {
    if (cond == null) return [];
    if (cond.all || cond.any) return (cond.all || cond.any).flatMap((c) => conditionErrors(c, scope));
    if (cond.not) return conditionErrors(cond.not, scope);
    if (cond.age) return scope === "member" ? [] : ["age condition outside member scope"];
    if (cond.isEmpty) return Array.isArray(get(app, cond.isEmpty)) ? [] : [`isEmpty ${cond.isEmpty} is not an array`];
    if (cond.field) {
        const [head, ...rest] = cond.field.split(".");
        let target;
        if (head === "member") target = scope === "member" ? get(ROOTS.member, rest.join(".")) : null;
        else if (head === "row") target = ROW_SCOPES.includes(scope) ? get(ROOTS[scope], rest.join(".")) : null;
        else target = get(app, cond.field);
        const ops = Object.keys(cond).filter((k) => k !== "field");
        const errors = [];
        if (!isField(target)) errors.push(`askIf field ${cond.field} is not a field in scope ${scope}`);
        if (ops.length !== 1 || !["equals", "in", "gt", "includesAny"].includes(ops[0])) errors.push(`bad operator ${ops}`);
        return errors;
    }
    return [`unknown condition ${JSON.stringify(cond)}`];
}

function entryErrors(entry) {
    const errors = [];
    if (!SECTIONS.includes(entry.section)) errors.push(`section ${entry.section}`);
    if (!ROOTS[entry.scope]) errors.push(`scope ${entry.scope}`);
    if (!INPUTS.includes(entry.input)) errors.push(`input ${entry.input}`);
    if (!entry.question) errors.push("no question text");
    if (entry.input === "checklist") {
        if (!entry.items?.length || !entry.noneLabel) errors.push("checklist needs items and noneLabel");
        for (const item of entry.items || []) {
            const target = get(entry.scope === "member" ? ROOTS.member : app, item.path);
            if (item.who ? !isWho(target) : !isField(target)) errors.push(`item path ${item.path}`);
            if (item.addRows && !item.id) errors.push(`addRows item ${item.path} needs an id`);
            errors.push(...conditionErrors(item.askIf, entry.scope));
        }
    } else if (entry.input === "whoFlag") {
        if (!isField(get(ROOTS.member, entry.path))) errors.push(`whoFlag member path ${entry.path}`);
        errors.push(...conditionErrors(entry.memberAskIf, "member"));
    } else {
        const target = get(ROOTS[entry.scope], entry.path);
        if (entry.input === "who" ? !isWho(target) : !isField(target)) errors.push(`path ${entry.scope}:${entry.path}`);
    }
    if (["select", "multiselect"].includes(entry.input) && !entry.options?.every((o) => o.value !== undefined && o.label)) {
        errors.push("select options need value + label");
    }
    if (entry.addRows && !ROW_SCOPES.includes(entry.addRows)) errors.push(`addRows ${entry.addRows}`);
    for (const path of Object.keys(entry.alsoSet || {})) {
        if (!isField(get(app, path))) errors.push(`alsoSet ${path}`);
    }
    errors.push(...conditionErrors(entry.askIf, entry.scope));
    return errors;
}

describe("QuestionBank.json", () => {
    it.each(Object.entries(QUESTION_BANK))("%s is valid against the applicant model", (_qid, entry) => {
        expect(entryErrors(entry)).toEqual([]);
    });

    it("keeps sections in asking order", () => {
        const order = Object.values(QUESTION_BANK).map((e) => SECTIONS.indexOf(e.section));
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("asks every fact the eligibility rules read", () => {
        const asked = new Set(Object.values(QUESTION_BANK).flatMap((e) => [
            `${e.scope}:${e.path}`, ...(e.items || []).map((i) => `${e.scope}:${i.path}`),
        ]));
        for (const needed of [
            "household:household.lives_in_new_york", "household:household.receives_snap_elsewhere",
            "household:household.has_income", "household:household.dependent_care_monthly",
            "member:dob", "member:citizen_status", "member:buys_and_prepares_with_household", "member:is_student",
            "member:meets_student_exemption", "member:receives_disability_benefits",
            "income:gross_amount", "income:frequency", "income:income_type",
        ]) {
            expect(asked, needed).toContain(needed);
        }
    });
});
