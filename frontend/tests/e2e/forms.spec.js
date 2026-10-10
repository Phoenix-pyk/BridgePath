// The last step: create the filled LDSS-4826, download it, then delete everything.
// Run: npm run test:e2e   then   npm run test:e2e:report

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
    ID_JANE, PAYSTUB_JANE, TITLES, addPeople, agreeToConsent, answerQuestions, expectResult, fill, mockUploads, snap,
    uploadFile,
} from "./flow.js";

test("Forms: download the filled LDSS-4826, then delete my information", async ({ page }) => {
    await mockUploads(page, [ID_JANE, PAYSTUB_JANE(900)]);
    await agreeToConsent(page);
    await uploadFile(page);
    await uploadFile(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, [["Leo", "Test"]]);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, [[/^What is Leo's date of birth/, fill("2018-05-02")]]);
    await expectResult(page, TITLES.eligible);

    await page.getByRole("button", { name: "Continue to my application forms" }).click();
    await expect(page.getByRole("heading", { name: "Your application" })).toBeVisible();
    await expect(page.getByText("SNAP: your household appears to qualify.")).toBeVisible();
    await snap(page, "Forms: before creating");

    await page.getByRole("button", { name: "Create my application" }).click();
    const link = page.getByRole("link", { name: "Download LDSS-4826 (PDF)" });
    await expect(link).toBeVisible();
    await expect(page.getByText("Sign and date it on page 8")).toBeVisible();
    await snap(page, "Forms: ready to download, with next steps");

    // The downloaded file is the real filled form (from the backend's pdf_filler)
    const downloading = page.waitForEvent("download");
    await link.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("LDSS-4826.pdf");
    const pdf = await readFile(await download.path());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.includes("Jane")).toBe(true);
    expect(pdf.includes("Leo")).toBe(true);

    await page.getByRole("button", { name: "Delete my information and start over" }).click();
    await expect(page.getByRole("checkbox")).not.toBeChecked();
    await expect(page.getByText("I Understand and agree")).toBeVisible();
    await snap(page, "After delete: back to the start, nothing kept");

    // Starting again really starts empty: the roster only has "You"
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("listitem")).toHaveText("You");
});

test("Forms: offered even when the screening says not eligible", async ({ page }) => {
    await agreeToConsent(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await addPeople(page, []);
    await page.getByRole("button", { name: "Continue" }).click();
    await answerQuestions(page, [[/live in New York State/, (p) => p.getByRole("button", { name: "No", exact: true }).click()]]);
    await expectResult(page, TITLES.notEligible);

    await page.getByRole("button", { name: "Continue to my application forms" }).click();
    await expect(page.getByText("SNAP: your household may not qualify, but you can still apply.")).toBeVisible();
    await page.getByRole("button", { name: "Create my application" }).click();
    await expect(page.getByRole("link", { name: "Download LDSS-4826 (PDF)" })).toBeVisible();
    await snap(page, "Forms: available after a not-eligible result");
});
