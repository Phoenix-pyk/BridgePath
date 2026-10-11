// How uploads are merged into `applicant` (mergeExtraction.js).

import { describe, expect, it } from "vitest";
import { field, makeEmptyApplicant } from "../../src/utils/applicantModel.js";
import { addPerson } from "../../src/utils/applicantEdits.js";
import { mergeExtraction, removeUploads, replaceTypedIncomes } from "../../src/utils/mergeExtraction.js";
import { leavesAreWrapped } from "./helpers.js";

const id = { primary_address: "123 Fake St, Queens, NY 11101", household_members: [{ first_name: "Jane", last_name: "Test", dob: "1990-01-31", is_applicant: true, other_names: ["Jane Doe"] }] };
const paystub = { incomes: [{ individual_name: "Jane Test", income_type: "wages", gross_amount: 1300, frequency: "biweekly" }] };
const birthCert = (first) => ({ household_members: [{ first_name: first, last_name: "Test", dob: "2018-05-02", is_applicant: false }] });

describe("mergeExtraction", () => {
    it("fills the applicant's empty fields from their ID, tagged as document", () => {
        const a = mergeExtraction(makeEmptyApplicant(), id, "u1");
        expect(a.household_members).toHaveLength(1);
        expect(a.household_members[0].dob).toEqual({ value: "1990-01-31", source: "document" });
        expect(a.primary_address.value).toMatch(/^123/);
        expect(leavesAreWrapped(a)).toBe(true);
    });

    it("never overwrites a user's answer or an earlier document's value", () => {
        let a = makeEmptyApplicant();
        a.household_members[0].citizen_status = field("us_citizen", "user");
        a = mergeExtraction(a, id, "u1");
        a = mergeExtraction(a, { primary_address: "999 Other Ave", household_members: [{ is_applicant: true, citizen_status: "other_noncitizen" }] }, "u2");
        expect(a.household_members[0].citizen_status.source).toBe("user");
        expect(a.primary_address.value).toMatch(/^123/);
    });

    it("keeps two documents of the same type (two children)", () => {
        let a = mergeExtraction(makeEmptyApplicant(), birthCert("Leo"), "u1");
        a = mergeExtraction(a, birthCert("Mia"), "u2");
        expect(a.household_members.map((m) => m.first_name.value)).toEqual([null, "Leo", "Mia"]);
    });

    it("links an income to its person by name", () => {
        let a = mergeExtraction(makeEmptyApplicant(), id, "u1");
        a = mergeExtraction(a, paystub, "u2");
        expect(a.incomes[0].member_id.value).toBe(a.household_members[0].id);
    });

    it("keeps question-only sections on every upload", () => {
        const a = mergeExtraction(makeEmptyApplicant(), paystub, "u1");
        expect(a.legal.snap_fraud_disqualified.answer.value).toBeNull();
        expect(a.household.on_strike).toBeDefined();
    });
});

describe("removeUploads", () => {
    it("drops only that upload's people and unlinks rows that pointed at them", () => {
        let a = mergeExtraction(makeEmptyApplicant(), birthCert("Leo"), "u1");
        a = mergeExtraction(a, birthCert("Mia"), "u2");
        const b = mergeExtraction(removeUploads(a, ["u1"]), birthCert("Leon"), "u3");
        expect(b.household_members.map((m) => m.first_name.value)).toEqual([null, "Mia", "Leon"]);
    });
});

describe("fixing a specific person (targetMemberId)", () => {
    it("fills that person instead of adding new people, and never makes them the applicant", () => {
        let a = mergeExtraction(makeEmptyApplicant(), id, "u1");
        a = addPerson(a, "Leo", "Test");
        const leo = a.household_members[1].id;
        // A birth certificate that also names the mother and calls Leo "Self"
        a = mergeExtraction(a, { household_members: [
            { first_name: "Leo", last_name: "Test", dob: "2018-05-02", is_applicant: true, relationship_to_applicant: "Self" },
            { first_name: "Jane", last_name: "Test", dob: "1990-01-31" },
        ] }, "u2", { targetMemberId: leo });
        expect(a.household_members).toHaveLength(2);
        const L = a.household_members[1];
        expect(L.dob).toEqual({ value: "2018-05-02", source: "document" });
        expect(L.is_applicant.value).toBe(false);
        expect(L.relationship_to_applicant.value).not.toBe("Self");
    });

    it("replaces typed income with the uploaded proof instead of counting it twice", () => {
        let a = mergeExtraction(makeEmptyApplicant(), id, "u1");
        const jane = a.household_members[0].id;
        a = { ...a, incomes: [{ ...mergeExtraction(makeEmptyApplicant(), paystub, "x").incomes[0], _upload_id: null,
            member_id: field(jane, "user"), gross_amount: field(900, "user"), income_type: field("wages", "user") }] };
        a = mergeExtraction(a, paystub, "proof", { targetMemberId: jane });
        expect(a.incomes).toHaveLength(2);
        a = replaceTypedIncomes(a, "proof", jane);
        expect(a.incomes).toHaveLength(1);
        expect(a.incomes[0].gross_amount).toEqual({ value: 1300, source: "document" });
    });
});
