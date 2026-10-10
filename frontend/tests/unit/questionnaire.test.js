// End-to-end run of the questionnaire logic for one household: Jane (from her
// ID and pay stub), Leo (7, from a birth certificate) and Sam (20, added on
// the roster). Checks what gets asked, of whom, and what gets saved.

import { beforeAll, describe, expect, it } from "vitest";
import { makeEmptyApplicant } from "../../src/utils/applicantModel.js";
import { mergeExtraction } from "../../src/utils/mergeExtraction.js";
import { addPerson, removePerson } from "../../src/utils/applicantEdits.js";
import { QUESTION_BANK, buildQueue, questionText } from "../../src/utils/questionQueue.js";
import { dobYearsAgo, leavesAreWrapped, runQuestionnaire } from "./helpers.js";

let a, seen, doneAdding, jane, sam, M;

beforeAll(() => {
    let start = makeEmptyApplicant();
    start = mergeExtraction(start, {
        primary_address: "123 Fake St, Queens, NY 11101",
        household_members: [{ first_name: "Jane", last_name: "Testperson", dob: dobYearsAgo(35), is_applicant: true, sex: "F" }],
    }, "id-upload");
    start = mergeExtraction(start, {
        incomes: [{ individual_name: "Jane Testperson", income_type: "wages", gross_amount: 1300, frequency: "biweekly", employer_or_source_name: "ACME" }],
    }, "paystub-upload");
    // The same child read twice (e.g. two documents) -> removed on the roster
    const leoDoc = { first_name: "Leo", last_name: "Testperson", dob: dobYearsAgo(7) };
    start = mergeExtraction(start, { household_members: [leoDoc, leoDoc] }, "bc-upload");
    start = removePerson(start, start.household_members[2].id);
    start = addPerson(start, "Sam", "Testperson");
    [jane, , sam] = start.household_members.map((m) => m.id);

    const picks = {
        relationship: "Child", citizenStatus: "us_citizen", sex: "M", maritalStatus: "Single", applicationType: "apply",
        incomeType: "wages", incomeFrequency: "monthly", livingSituation: ["rent"], incomeAmount: 500,
        livesInNewYork: true, hasMoreIncome: true, studentExemption: true, dependentCareMonthly: 0,
    };
    ({ applicant: a, seen, doneAdding } = runQuestionnaire(start, {
        answer(item) {
            if (item.qid === "dob" && item.memberId === sam) return dobYearsAgo(20);
            if (item.qid === "isStudent") return item.memberId === sam;
            if (item.qid === "incomeMember") return sam;
            if (item.qid === "resourceFlags") return { checked: ["household.has_vehicles"], who: {} };
            if (item.qid === "anyonePregnant") return [jane];
            if (item.qid === "legalFlags") {
                return { checked: ["legal.snap_fraud_disqualified"], who: { "legal.snap_fraud_disqualified": [sam] } };
            }
            return picks[item.qid];
        },
    }));
    M = a.household_members;
});

describe("questionnaire for a household of three", () => {
    it("finishes with nothing left to ask", () => {
        expect(buildQueue(a, { doneAdding })).toEqual([]);
    });

    it("doesn't re-ask what documents answered", () => {
        expect(seen).not.toContain("firstName@0");
        expect(seen).not.toContain("dob@0");
        expect(seen).not.toContain("incomeMember#0"); // the pay stub's income was linked to Jane by name
    });

    it("asks roster questions only where they apply", () => {
        expect(seen).toContain("relationship@1");
        expect(seen).not.toContain("relationship@0");
    });

    it("asks student questions by age and answer", () => {
        expect(seen).toContain("isStudent@2");
        expect(seen).toContain("studentExemption@2");
        expect(seen).not.toContain("studentExemption@0");
        expect(seen.some((s) => s.startsWith("educationLevel@1"))).toBe(false); // Leo is 7
    });

    it("asks pregnancy once for the household and the due date only for who's pregnant", () => {
        expect(seen.filter((s) => s === "anyonePregnant")).toHaveLength(1);
        expect(seen).toContain("pregnancyDueDate@0");
        expect(M[0].is_pregnant).toEqual({ value: true, source: "user" });
        expect(M[2].is_pregnant).toEqual({ value: false, source: "user" });
        expect(M[1].is_pregnant).toEqual({ value: false, source: "derived" }); // under 16
    });

    it("links an added income to its person and keeps the name in sync", () => {
        expect(a.incomes).toHaveLength(2);
        expect(a.incomes[1].member_id.value).toBe(sam);
        expect(a.incomes[1].individual_name.value).toBe("Sam Testperson");
        expect(seen).toContain("incomeMember#1");
        expect(seen).toContain("addAnother:hasMoreIncome");
    });

    it("adds a vehicle row from the resources checklist with its type preset", () => {
        expect(a.assets).toHaveLength(1);
        expect(a.assets[0].resource_type).toEqual({ value: "vehicle", source: "user" });
        expect(seen).toContain("addAnother:hasVehicles");
        expect(seen.some((s) => s.startsWith("assetType"))).toBe(false);
    });

    it("asks the six legal questions as one page and saves all six", () => {
        expect(seen.filter((s) => s === "legalFlags")).toHaveLength(1);
        expect(a.legal.snap_fraud_disqualified.answer.value).toBe(true);
        expect(a.legal.snap_fraud_disqualified.who.value).toEqual([sam]);
        expect(a.legal.sold_snap_500_or_more.answer.value).toBe(false);
        expect(M[2].has_snap_disqualification).toEqual({ value: true, source: "derived" });
        expect(M[0].has_snap_disqualification).toEqual({ value: false, source: "derived" });
    });

    it("asks one person checklist per person and derives what can't apply", () => {
        expect(seen.filter((s) => s.startsWith("personFlags@"))).toHaveLength(3);
        expect(M[1].is_veteran).toEqual({ value: false, source: "derived" });
        expect(M[0].is_veteran.source).toBe("user");
    });

    it("saves the letter checklist's unticked values and skips the format question", () => {
        expect(a.application.notice_language.value).toBe("english");
        expect(a.application.needs_alt_format.value).toBe(false);
        expect(a.application.alt_format).toEqual({ value: "none", source: "derived" });
        expect(seen).not.toContain("altFormat");
    });

    it("applies alsoSet (rent is monthly)", () => {
        expect(a.shelter.frequency.value).toBe("monthly");
    });

    it("keeps every leaf exactly {value, source}", () => {
        expect(leavesAreWrapped(a)).toBe(true);
    });
});

describe("question wording", () => {
    it("speaks to the applicant as 'you'", () => {
        expect(questionText(QUESTION_BANK.isStudent, M[0])).toMatch(/^Are you enrolled/);
        expect(questionText(QUESTION_BANK.personFlags, M[0])).toBe("Do any of these apply to you?");
        expect(questionText(QUESTION_BANK.primaryLanguage, M[0])).toBe("What language do you speak most often?");
    });

    it("uses other people's first names", () => {
        expect(questionText(QUESTION_BANK.isStudent, M[2])).toMatch(/^Is Sam enrolled/);
        expect(questionText(QUESTION_BANK.personFlags, M[2])).toBe("Do any of these apply to Sam?");
    });
});
