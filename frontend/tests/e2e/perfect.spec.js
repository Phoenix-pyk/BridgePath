// A complete applicant: every document type they'd have, every question
// answered with real information (nothing skipped), then the filled LDSS-4826
// is checked for that information.
// Run: npm run test:e2e   then   npm run test:e2e:report

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
    TITLES, addPeople, agreeToConsent, answerEveryQuestion, choose, expectResult, fill, mockUploads, no,
    noneOfThese, pressButton, snap, tick, uploadFiles, yes,
} from "./flow.js";

// Jane Test, 35, works part-time at ACME Cafe and rents an apartment in Queens
// with her son Leo, 8.
const JANE = { first_name: "Jane", last_name: "Test", is_applicant: true };
const DOCUMENTS = [
    {
        documentType: "id",
        fields: {
            primary_address: "123 Main St, Apt 4B, Queens, NY 11101",
            household_members: [{ ...JANE, dob: "1990-01-31", sex: "F", relationship_to_applicant: "Self" }],
            incomes: null, shelter: null, assets: null,
        },
        issues: [],
    },
    {
        documentType: "pay_stub",
        fields: {
            household_members: [JANE],
            incomes: [{
                individual_name: "Jane Test", employer_or_source_name: "ACME Cafe", income_type: "wages",
                gross_amount: 1400, frequency: "monthly", hours_worked_per_month: 96, employment_type: "employed",
            }],
            shelter: null, assets: null,
        },
        issues: [],
    },
    {
        documentType: "birth_certificate",
        fields: {
            household_members: [
                { first_name: "Leo", last_name: "Test", dob: "2018-05-02", sex: "M" },
                { first_name: "Jane", last_name: "Test" },
            ],
            incomes: null, shelter: null, assets: null,
        },
        issues: [],
    },
    {
        documentType: "lease",
        fields: {
            primary_address: "123 Main St, Apt 4B, Queens, NY 11101",
            household_members: [JANE],
            incomes: null,
            shelter: {
                rent_or_mortgage_amount: 1100, frequency: "monthly", landlord_name: "Queens Homes LLC",
                landlord_phone: "7185550199", utilities: null, lease_start_date: "2024-03-01",
            },
            assets: null,
        },
        issues: [],
    },
    {
        documentType: "utility_bill",
        fields: {
            household_members: [JANE],
            incomes: null,
            shelter: { utilities: [{ utility_type: "electric_lighting", is_included_in_rent: false, monthly_cost: 85 }] },
            assets: null,
        },
        issues: [],
    },
    {
        documentType: "bank_statement",
        fields: {
            household_members: [JANE],
            incomes: null, shelter: null,
            assets: [{ resource_type: "checking", amount: 350 }],
        },
        issues: [],
    },
];

const YOU = /^You/;
const LEO = /Leo/;
const ANSWERS = [
    // Basics
    [/applying for SNAP for the first time, or renewing/, choose("Applying")],
    [/^Do any of these apply to you\?/, noneOfThese], // letters in Spanish / another format
    [/^What is your phone number/, fill("718 555 0100")],
    [/another phone number/, fill("718 555 0111")],
    [/^What is your home address/, fill("123 Main St, Apt 4B, Queens, NY 11101")],
    [/Where should SNAP mail your letters/, pressButton("Same as my home address")],

    // About each person
    [/first name/, fill("Jane")],
    [/last name/, fill("Test")],
    [/middle initial/, fill("R"), YOU],
    [/middle initial/, fill("J"), LEO],
    [/How is Leo related to you/, choose("Child")],
    [/buy and make food together with Leo/, yes],
    [/applying for SNAP\?/, yes],
    [/date of birth/, fill("1990-01-31"), YOU],
    [/date of birth/, fill("2018-05-02"), LEO],
    [/sex\?/, choose("Female"), YOU],
    [/sex\?/, choose("Male"), LEO],
    [/marital status/, choose("Divorced"), YOU],
    [/marital status/, choose("Single (never married)"), LEO],
    [/Social Security number/, fill("123-45-6789"), YOU],
    [/Social Security number/, fill("987-65-4321"), LEO],
    [/other names/, fill("Jane Smith"), YOU],
    [/other names/, pressButton("No other names"), LEO],
    [/U\.S\. citizen/, choose("Yes, U.S. citizen or U.S. national")],
    [/Hispanic or Latino/, no],
    [/race\?/, tick("White")],
    [/highest level of school/, choose("High school diploma or equivalency (GED/TASC)")],
    [/language/, fill("English")],
    [/^Do any of these apply to (you|Leo)\?/, noneOfThese], // disability, spenddown, veteran, foster care
    [/boarder, foster child or foster adult/, choose("No")],
    [/enrolled at least half-time/, no],
    [/age 16 or older pregnant/, pressButton("No one")],
    [/limits how much or what kind of work/, pressButton("No one")],

    // Household
    [/live in New York State/, yes],
    [/SNAP or cash assistance somewhere else|^Do any of these apply to anyone in your household\?/, noneOfThese],

    // Income (the pay stub is already in)
    [/income that isn't on the documents/, no],
    [/get any other income/, no],
    [/child care or adult dependent care/, fill(0)],

    // Resources (the bank statement is already in)
    [/Who does this belong to/, choose("You (Jane)")],
    [/^Does anyone in your household have any of these/, noneOfThese],
    [/sold, given away or transferred/, no],

    // Housing
    [/describe where you live/, tick("I rent")],
    [/rent or mortgage each month/, fill(1100)],
    [/separately from your rent/, tick("Other utilities")],
    [/anyone else pay any of these housing costs/, no],
    [/court-ordered child support/, no],

    // Legal, representative, notes
    [/apply for you or use an EBT card/, no],
    [/anything else you want SNAP to know/, fill("I work part-time and my hours change from week to week.")],
];

test("Complete applicant: every document and every answer, then the filled form", async ({ page }) => {
    test.setTimeout(120_000);
    await mockUploads(page, DOCUMENTS);
    await agreeToConsent(page);

    await uploadFiles(page, DOCUMENTS.map((d) => ({ name: `${d.documentType}.pdf`, mimeType: "application/pdf" })));
    await expect(page.getByText(`${DOCUMENTS.length} documents read ✓`)).toBeVisible();
    for (const label of ["Photo ID", "Pay stub", "Birth certificate", "Lease", "Utility bill", "Bank statement"]) {
        await expect(page.getByRole("listitem").filter({ hasText: label }).first()).toContainText("Done");
    }
    await snap(page, "Upload: all six documents read");
    await page.getByRole("button", { name: "Continue" }).click();

    // Leo comes from the birth certificate, so no one needs adding. The mother
    // named on it is Jane again (people aren't merged across documents yet), so
    // remove that duplicate like a real applicant would.
    await addPeople(page, []);
    await snap(page, "Roster: Jane listed twice (from the birth certificate)");
    await page.getByRole("listitem").filter({ hasText: /^Jane Test/ }).getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByRole("listitem").filter({ hasText: "Leo Test" })).toBeVisible();
    await snap(page, "Roster: Jane and Leo");
    await page.getByRole("button", { name: "Continue" }).click();

    await answerEveryQuestion(page, ANSWERS);
    await expectResult(page, TITLES.eligible);
    await snap(page, "Results: eligible, nothing missing");

    await page.getByRole("button", { name: "Continue to my application forms" }).click();
    await page.getByRole("button", { name: "Create my application" }).click();
    const link = page.getByRole("link", { name: "Download LDSS-4826 (PDF)" });
    await expect(link).toBeVisible();
    await snap(page, "Forms: ready to download");

    const downloading = page.waitForEvent("download");
    await link.click();
    const pdf = (await readFile(await (await downloading).path())).toString("latin1");
    for (const text of ["Jane", "Leo", "Test", "123 Main St", "Queens", "11101", "ACME Cafe", "123-45-6789", "English"]) {
        expect(pdf, `the form should contain "${text}"`).toContain(text);
    }
});
