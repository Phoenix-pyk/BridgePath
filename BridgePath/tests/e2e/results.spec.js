// Every way the results screen can turn out, clicked through in a real
// browser. Run: npm run test:e2e   then   npm run test:e2e:report
// Each test's screenshots are attached to the report under the step names.

import { expect, test } from "@playwright/test";
import {
    BIRTH_CERT_LEO, ID_JANE, PAYSTUB_JANE, TITLES, addPeople, agreeToConsent, answerQuestions, choose,
    expectResult, fill, mockUploads, no, snap, uploadFile, yes,
} from "./flow.js";

// Answers for typing in Jane's job income instead of uploading a pay stub
const typedIncome = (amount) => [
    [/^Does anyone in your household get any income\?/, yes],
    [/^Who gets this income\?/, choose("You (Jane)")],
    [/^What kind of income is this\?/, choose("Job (wages)")],
    [/^Who pays this income\?/, fill("ACME Cafe")],
    [/^How much is each payment/, fill(amount)],
    [/^How often is it paid\?/, choose("Once a month")],
    [/hours a month/, fill(80)],
];

test("Not eligible right away: doesn't live in New York", async ({ page }) => {
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, []);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, [[/live in New York State/, no]]);

    await expectResult(page, TITLES.notEligible);
    await expect(page.getByText("SNAP through this tool is for New York State residents.")).toBeVisible();
    await expect(page.getByText("You still have the right to apply")).toBeVisible();
    await snap(page, "Results: not eligible (not a NY resident)");
});

test("Eligible: ID and pay stub uploaded, low income", async ({ page }) => {
    await mockUploads(page, [ID_JANE, PAYSTUB_JANE(900)]);
    await agreeToConsent(page);
    await uploadFile(page);
    await uploadFile(page);
    await expect(page.getByText(/Photo ID\s*✓/)).toBeVisible();
    await expect(page.getByText(/Pay stub\s*✓/)).toBeVisible();
    await snap(page, "Upload: ID and pay stub read");
    await page.getByRole("button", { name: "Continue" }).click();

    await addPeople(page, [["Leo", "Test"]]);
    await snap(page, "Roster: Jane (from ID) + Leo added");
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, [[/^What is Leo's date of birth/, fill("2018-05-02")]]);

    await expectResult(page, TITLES.eligible);
    await snap(page, "Results: eligible");
});

test("Not eligible: income over the limit", async ({ page }) => {
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, []);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, typedIncome(8000));

    await expectResult(page, TITLES.notEligible);
    await expect(page.getByText(/gross monthly income appears to be over the SNAP limit/)).toBeVisible();
    await snap(page, "Results: not eligible (income $8,000/month, household of 1)");
});

test("Needs something: typed income needs proof, then the pay stub upload fixes it", async ({ page }) => {
    await mockUploads(page, [PAYSTUB_JANE(900)]);
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, []);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, typedIncome(900));

    await expectResult(page, TITLES.needs);
    const proof = page.getByRole("listitem").filter({ hasText: "Proof of job income" });
    await expect(proof).toBeVisible();
    await expect(proof.getByRole("button", { name: "Answer" })).toHaveCount(0);
    await snap(page, "Results: needs proof of typed income");

    await proof.getByRole("button", { name: /^Upload pay stub or employer letter$/ }).click();
    await expect(page.getByRole("heading", { name: "Upload a document" })).toBeVisible();
    await expect(page.getByText(/This is for You/)).toBeVisible();
    await snap(page, "Fixing: upload screen shows only pay stub / employer letter");
    await uploadFile(page);
    await page.getByRole("button", { name: "Back to my results" }).click();

    await expectResult(page, TITLES.eligible);
    await snap(page, "Results after uploading the pay stub: eligible");
});

test("Needs something: skipped date of birth, fixed with Answer", async ({ page }) => {
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, [["Leo", "Test"]]);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, [[/^What is Leo's date of birth/, (p) => p.getByRole("button", { name: "Skip for now" }).click()]]);

    await expectResult(page, TITLES.needs);
    const dob = page.getByRole("listitem").filter({ hasText: "What is Leo's date of birth?" });
    await expect(dob.getByRole("button", { name: "Answer" })).toBeVisible();
    await expect(dob.getByRole("button", { name: /^Upload/ })).toBeVisible();
    await snap(page, "Results: Leo's date of birth missing (Answer / Upload)");

    await dob.getByRole("button", { name: "Answer" }).click();
    await expect(page.getByRole("heading", { name: "What is Leo's date of birth?" })).toBeVisible();
    await expect(page.getByText(/Question 1 of 1/)).toBeVisible();
    await snap(page, "Fixing: only that one question");
    await answerQuestions(page, [[/^What is Leo's date of birth/, fill("2018-05-02")]]);

    await expectResult(page, TITLES.eligible);
    await snap(page, "Results after answering: eligible");
});

test("Needs something: skipped date of birth, fixed by uploading Leo's birth certificate", async ({ page }) => {
    await mockUploads(page, [BIRTH_CERT_LEO]);
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, [["Leo", "Test"]]);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, [[/^What is Leo's date of birth/, (p) => p.getByRole("button", { name: "Skip for now" }).click()]]);

    await expectResult(page, TITLES.needs);
    const dob = page.getByRole("listitem").filter({ hasText: "What is Leo's date of birth?" });
    await dob.getByRole("button", { name: /^Upload/ }).click();
    await expect(page.getByText("This is for Leo Test.")).toBeVisible();
    await snap(page, "Fixing: upload for Leo (photo ID or birth certificate only)");
    await uploadFile(page);
    await page.getByRole("button", { name: "Back to my results" }).click();

    // The certificate also named Jane and called Leo "Self": no one was added, Leo got his DOB
    await expectResult(page, TITLES.eligible);
    await snap(page, "Results after the birth certificate: eligible");
});

test("Needs something: several skipped answers, fixed with Answer all of these", async ({ page }) => {
    const skipIt = (p) => p.getByRole("button", { name: "Skip for now" }).click();
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, [["Leo", "Test"]]);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, [
        [/^What is Leo's date of birth/, skipIt],
        [/^Is Leo a U\.S\. citizen/, skipIt],
        [/live in New York State/, skipIt],
    ]);

    await expectResult(page, TITLES.needs);
    await expect(page.getByRole("listitem")).toHaveCount(3);
    await snap(page, "Results: three answers missing");

    await page.getByRole("button", { name: "Answer all of these" }).click();
    await expect(page.getByText(/Question 1 of 3/)).toBeVisible();
    await snap(page, "Fixing: just the three missing questions");
    await answerQuestions(page, [[/^What is Leo's date of birth/, fill("2018-05-02")]]);

    await expectResult(page, TITLES.eligible);
    await snap(page, "Results after answering all: eligible");
});

test("Error: backend unreachable, then Try again works", async ({ page }) => {
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, []);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.route("**/api/eligibility", (route) => route.abort());
    await answerQuestions(page);

    await expect(page.getByRole("heading", { name: "We couldn't check your eligibility" })).toBeVisible();
    await expect(page.getByText("Can't reach server")).toBeVisible();
    await snap(page, "Results: can't reach server");

    await page.unroute("**/api/eligibility");
    await page.getByRole("button", { name: "Try again" }).click();
    await expectResult(page, TITLES.eligible);
    await snap(page, "Results after Try again: eligible");
});
