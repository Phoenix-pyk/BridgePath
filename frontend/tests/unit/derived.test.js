// Values syncDerived fills in because they follow from other answers (source "derived").

import { describe, expect, it } from "vitest";
import { field, makeEmptyApplicant } from "../../src/utils/applicantModel.js";
import { addPerson, removePerson, syncDerived } from "../../src/utils/applicantEdits.js";
import { dobYearsAgo } from "./helpers.js";

function withChild(age) {
    let a = addPerson(makeEmptyApplicant(), "Leo", "Test");
    a.household_members[1].dob = field(dobYearsAgo(age), "user");
    return syncDerived(a);
}

describe("syncDerived", () => {
    it("answers age-limited facts for a young child", () => {
        const leo = withChild(7).household_members[1];
        for (const key of ["is_veteran", "foster_care_at_18", "is_pregnant", "has_work_limiting_condition", "in_school_or_training"]) {
            expect(leo[key], key).toEqual({ value: false, source: "derived" });
        }
    });

    it("leaves them unanswered when the age is unknown", () => {
        const a = syncDerived(addPerson(makeEmptyApplicant(), "Leo", "Test"));
        expect(a.household_members[1].is_veteran.value).toBeNull();
    });

    it("clears derived answers if a corrected DOB puts the person in range, but keeps real answers", () => {
        let a = withChild(7);
        a.household_members[1].dob = field(dobYearsAgo(20), "user");
        a = syncDerived(a);
        const leo = a.household_members[1];
        expect(leo.is_veteran.value).toBeNull();
        expect(leo.is_pregnant.value).toBeNull();
        expect(leo.in_school_or_training).toEqual({ value: false, source: "derived" }); // 20 is outside 16-17
    });

    it("sets the applicant's boarder/foster to none", () => {
        const a = syncDerived(makeEmptyApplicant());
        expect(a.household_members[0].boarder_or_foster).toEqual({ value: "none", source: "derived" });
    });

    it("sets alt_format to none only when no other format is needed", () => {
        let a = makeEmptyApplicant();
        a.application.needs_alt_format = field(false, "user");
        a = syncDerived(a);
        expect(a.application.alt_format).toEqual({ value: "none", source: "derived" });
        a.application.needs_alt_format = field(true, "user");
        a = syncDerived(a);
        expect(a.application.alt_format.value).toBeNull();
    });

    it("derives has_snap_disqualification only once all six legal questions are answered", () => {
        let a = makeEmptyApplicant();
        a.legal.snap_fraud_disqualified = { answer: field(false, "user"), who: field([], "user") };
        expect(syncDerived(a).household_members[0].has_snap_disqualification.value).toBeNull();
        for (const q of Object.keys(a.legal)) a.legal[q] = { answer: field(false, "user"), who: field([], "user") };
        expect(syncDerived(a).household_members[0].has_snap_disqualification).toEqual({ value: false, source: "derived" });
    });
});

describe("removePerson", () => {
    it("removes every reference to the person", () => {
        let a = addPerson(makeEmptyApplicant(), "Sam", "Test");
        const sam = a.household_members[1].id;
        a.legal.snap_fraud_disqualified = { answer: field(true, "user"), who: field([sam], "user") };
        a.household.dependent_care_who = field([sam], "user");
        a = removePerson(a, sam);
        expect(a.household_members).toHaveLength(1);
        expect(a.legal.snap_fraud_disqualified.who.value).toEqual([]);
        expect(a.household.dependent_care_who.value).toEqual([]);
    });

    it("never removes the applicant", () => {
        const a = makeEmptyApplicant();
        expect(removePerson(a, a.household_members[0].id).household_members).toHaveLength(1);
    });
});
