// Uploading several documents at once.
// Run: npm run test:e2e   then   npm run test:e2e:report

import { expect, test } from "@playwright/test";
import { ID_JANE, PAYSTUB_JANE, agreeToConsent, mockUploads, snap, uploadFiles } from "./flow.js";

test("Upload: select several files at once, one bad file doesn't stop the rest", async ({ page }) => {
    // Read in order: ID, pay stub, then something that isn't a listed document
    await mockUploads(page, [ID_JANE, PAYSTUB_JANE(900), { documentType: "other", fields: {}, issues: [] }]);
    let requests = 0;
    page.on("request", (r) => { if (r.url().endsWith("/api/extract")) requests += 1; });

    await agreeToConsent(page);
    await expect(page.getByText("You can select several files at once.")).toBeVisible();
    await uploadFiles(page, [
        { name: "drivers-license.png", mimeType: "image/png" },
        { name: "paystub.pdf", mimeType: "application/pdf" },
        { name: "grocery-receipt.jpg", mimeType: "image/jpeg" },
        { name: "notes.txt", mimeType: "text/plain" },
    ]);

    await expect(page.getByText(/Photo ID\s*✓/)).toBeVisible();
    await expect(page.getByText(/Pay stub\s*✓/)).toBeVisible();
    await expect(page.getByText("2 documents read ✓")).toBeVisible();
    await expect(page.getByText("2 files weren't added:")).toBeVisible();
    await expect(page.getByText(/^grocery-receipt\.jpg: We couldn't recognize this document/)).toBeVisible();
    await expect(page.getByText("notes.txt: Please upload a JPG, PNG, or PDF.")).toBeVisible();
    expect(requests).toBe(3); // the .txt never reached the backend
    await snap(page, "Upload: 4 files selected → 2 read, 1 not recognized, 1 wrong type");

    // Both documents' data is in: Jane from the ID, her income from the pay stub
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("You (Jane)")).toBeVisible();
});
