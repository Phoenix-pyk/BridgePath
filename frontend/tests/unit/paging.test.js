// Which page the question screen shows (pickPage) and the fixing subset (fixingPages).

import { describe, expect, it } from "vitest";
import { field, makeEmptyApplicant } from "../../src/utils/applicantModel.js";
import { applyAnswer, addPerson } from "../../src/utils/applicantEdits.js";
import { fixingPages, itemKey, listItems, pickPage } from "../../src/utils/questionQueue.js";
import { dobYearsAgo, runQuestionnaire } from "./helpers.js";

function finishedHousehold() {
    let a = addPerson(makeEmptyApplicant(), "Sam", "Test");
    a = runQuestionnaire(a, {
        answer: (item) => (item.qid === "dob" ? dobYearsAgo(item.memberId === a.household_members[1].id ? 20 : 35)
            : item.qid === "isStudent" ? true : undefined),
    }).applicant;
    return a;
}

describe("pickPage", () => {
    it("starts at the first unanswered page", () => {
        const items = listItems(makeEmptyApplicant());
        expect(pickPage(items, { type: "next", from: 0, lastKey: null })).toBe(0);
    });

    it("shows an answered page when the user jumps to it", () => {
        const a = finishedHousehold();
        const items = listItems(a);
        expect(pickPage(items, { type: "page", key: itemKey(items[5]), index: 5 })).toBe(5);
    });

    it("ends when nothing is unanswered, and End always ends", () => {
        const items = listItems(finishedHousehold());
        expect(pickPage(items, { type: "next", from: 0, lastKey: null })).toBe(-1);
        expect(pickPage(items, { type: "end" })).toBe(-1);
    });

    it("wraps around to an earlier unanswered page, but not a skipped one", () => {
        const a = finishedHousehold();
        const items = listItems(a);
        const b = applyAnswer(a, items[3], null); // page 4 unanswered again
        const again = listItems(b);
        expect(pickPage(again, { type: "next", from: 50, lastKey: "x" })).toBe(3);
        expect(pickPage(again, { type: "next", from: 50, lastKey: "x" }, new Set([itemKey(again[3])]))).toBe(-1);
    });

    it("renumbers pages when an answer removes follow-ups", () => {
        const a = finishedHousehold();
        const sam = a.household_members[1].id;
        const samsExemption = (x) => listItems(x).some((i) => i.qid === "studentExemption" && i.memberId === sam);
        expect(samsExemption(a)).toBe(true);
        const student = listItems(a).find((i) => i.qid === "isStudent" && i.memberId === sam);
        const b = applyAnswer(a, student, false);
        expect(samsExemption(b)).toBe(false);
    });
});

describe("fixingPages", () => {
    it("shows only the items being fixed, plus follow-ups that appear while answering", () => {
        let a = finishedHousehold();
        const jane = a.household_members[0].id;
        a = { ...a, household_members: a.household_members.map((m) => (m.id === jane ? { ...m, is_student: field() } : m)) };
        const fix = [{ qid: "isStudent", memberId: jane }];
        const initial = new Set(listItems(a).map(itemKey));

        let pages = fixingPages(listItems(a), fix, initial);
        expect(pages.map((p) => p.qid)).toEqual(["isStudent"]);

        a = applyAnswer(a, pages[0], true);
        pages = fixingPages(listItems(a), fix, initial);
        expect(pages.map((p) => p.qid)).toEqual([
            "isStudent", "schoolName", "schoolFullTime", "schoolIncome", "schoolExpenses", "studentExemption",
        ]);
    });
});
