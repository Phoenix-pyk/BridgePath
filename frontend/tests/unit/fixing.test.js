// Turning eligibility's `missing` items into Answer / Upload buttons (fixPlan.js).

import { describe, expect, it } from "vitest";
import { field, makeEmptyApplicant, makeIncome } from "../../src/utils/applicantModel.js";
import { addPerson } from "../../src/utils/applicantEdits.js";
import { answerAll, planFix } from "../../src/utils/fixPlan.js";

function household() {
    let a = addPerson(makeEmptyApplicant(), "Leo", "Test");
    a.household_members[0].first_name = field("Jane", "user");
    a.incomes = [makeIncome({ member_id: field(a.household_members[0].id, "user"), gross_amount: field(900, "user") })];
    return a;
}

describe("planFix", () => {
    it("a missing DOB gets Answer and Upload, both for that person", () => {
        const a = household();
        const leo = a.household_members[1].id;
        const plan = planFix(a, { type: "question", item: "household_members[].dob", memberIndex: 1 });
        expect(plan.text).toBe("What is Leo's date of birth?");
        expect(plan.answer).toEqual({ type: "question", items: [{ qid: "dob", memberId: leo }] });
        expect(plan.upload).toMatchObject({ type: "document", memberId: leo });
        expect(plan.upload.items).toEqual(expect.arrayContaining(["birth_certificate", "id"]));
    });

    it("a question only the applicant can answer gets Answer only", () => {
        const plan = planFix(household(), { type: "question", item: "household.lives_in_new_york", memberIndex: null });
        expect(plan.answer).toEqual({ type: "question", items: [{ qid: "livesInNewYork" }] });
        expect(plan.upload).toBeNull();
    });

    it("a checklist line shows that line's label", () => {
        const plan = planFix(household(), { type: "question", item: "household_members[].receives_disability_benefits", memberIndex: 0 });
        expect(plan.text).toMatch(/^You \(Jane\): Gets disability benefits/);
        expect(plan.answer.items[0].qid).toBe("personFlags");
    });

    it("a missing income field asks about that person's incomes that are still empty", () => {
        const a = household();
        const plan = planFix(a, { type: "question", item: "incomes[].frequency", memberIndex: 0 });
        expect(plan.answer.items).toEqual([{ qid: "incomeFrequency", rowId: a.incomes[0].id }]);
        expect(plan.upload).toBeNull(); // uploading would add a second copy of the income
    });

    it("missing proof gets Upload only, marked as proof for that person", () => {
        const a = household();
        const plan = planFix(a, { type: "document", item: "earned_income_employer", memberIndex: 0 });
        expect(plan.text).toMatch(/^Proof of job income/);
        expect(plan.answer).toBeNull();
        expect(plan.upload).toMatchObject({ type: "document", items: ["pay_stub", "employer_letter"], proof: true, memberId: a.household_members[0].id });
    });

    it("an empty roster has a label but no button yet", () => {
        expect(planFix(household(), { type: "question", item: "household_members", memberIndex: null }))
            .toEqual({ text: "Who lives in your household", answer: null, upload: null });
    });
});

describe("answerAll", () => {
    it("combines every answerable item without duplicates", () => {
        const a = household();
        const dob = planFix(a, { type: "question", item: "household_members[].dob", memberIndex: 1 });
        const ny = planFix(a, { type: "question", item: "household.lives_in_new_york", memberIndex: null });
        const proof = planFix(a, { type: "document", item: "earned_income_employer", memberIndex: 0 });
        expect(answerAll([dob, dob, ny, proof]).items).toHaveLength(2);
        expect(answerAll([proof])).toBeNull();
    });
});
