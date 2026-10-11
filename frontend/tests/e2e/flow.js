// Helpers that drive the app like a person would. Questions are answered by
// their visible heading; anything a scenario doesn't care about gets
// "Skip for now", so each test only spells out what matters to it.

import { expect, test } from "@playwright/test";

// A screenshot attached to the HTML report under this step's name
export async function snap(page, name) {
    await test.info().attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

// Answer /api/extract with fixture results, in order, instead of calling Gemini
export async function mockUploads(page, responses) {
    const queue = [...responses];
    await page.route("**/api/extract", (route) =>
        route.fulfill({ json: queue.shift() ?? { documentType: "other", fields: {}, issues: [] } })
    );
}

// Click "Upload files" and choose (fake) files; the mocked /api/extract decides what each "contains".
// files: [{ name, mimeType }] (default: one PNG)
export async function uploadFiles(page, files = [{ name: "document.png", mimeType: "image/png" }]) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload files" }).click();
    await (await chooser).setFiles(files.map((f) => ({ ...f, buffer: Buffer.from("fake file") })));
    await expect(page.getByText(/^Reading document/)).toBeHidden();
}

export const uploadFile = (page) => uploadFiles(page);

export async function agreeToConsent(page) {
    await page.goto("/");
    await page.getByRole("button", { name: "I'm ready to apply" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Upload your documents" })).toBeVisible();
}

export async function addPeople(page, people) {
    await expect(page.getByRole("heading", { name: "Who lives with you?" })).toBeVisible();
    for (const [first, last] of people) {
        await page.getByLabel("First name").fill(first);
        await page.getByLabel("Last name").fill(last);
        await page.getByRole("button", { name: "Add person" }).click();
    }
}

// Typical household answers: everyone's a citizen, shares food, is applying.
// `overrides` is [[headingRegex, action], ...] checked first; actions are
// helpers below (yes, no, choose(...), fill(...), skip, ...).
export const yes = (page) => page.getByRole("button", { name: "Yes", exact: true }).click();
export const no = (page) => page.getByRole("button", { name: "No", exact: true }).click();
export const skip = (page) => page.getByRole("button", { name: "Skip for now" }).click();
export const noneOfThese = (page) => page.getByRole("button", { name: /^None of these/ }).click();
export const choose = (label) => (page) => page.getByRole("button", { name: label, exact: true }).click();
export const fill = (text) => async (page) => {
    await page.locator("input:visible, textarea:visible").first().fill(String(text));
    await page.getByRole("button", { name: "Continue" }).click();
};

const DEFAULTS = [
    [/^What is your first name/, fill("Jane")],
    [/^What is your last name/, fill("Test")],
    [/date of birth/, fill("1990-01-31")],
    [/a U\.S\. citizen/, choose("Yes, U.S. citizen or U.S. national")],
    [/buy and make food together/, yes],
    [/applying for SNAP\?/, yes],
    [/enrolled at least half-time/, no],
    [/live in New York State/, yes],
    [/^Do any of these apply to anyone in your household/, noneOfThese],
    [/^Does anyone in your household get any income\?/, no],
    [/income that isn't on the documents/, no],
    [/get any other income\?/, no],
    [/child care or adult dependent care/, fill(0)],
];

async function onEndPage(page) {
    return page.getByRole("button", { name: /^(See my results|Check my results again)$/ }).isVisible();
}

// Answer question pages until the end page, then go to results.
export async function answerQuestions(page, overrides = [], { maxPages = 120 } = {}) {
    const rules = [...overrides, ...DEFAULTS];
    for (let n = 0; n < maxPages; n++) {
        await page.waitForLoadState("domcontentloaded");
        if (await onEndPage(page)) {
            await page.getByRole("button", { name: /^(See my results|Check my results again)$/ }).click();
            return;
        }
        const heading = await page.getByRole("heading", { level: 1 }).first().innerText();
        const before = await page.locator("body").innerText();
        const rule = rules.find(([pattern]) => pattern.test(heading));
        if (rule) await rule[1](page);
        else await skip(page);
        // Wait for the next page to render
        await page.waitForFunction((prev) => document.body.innerText !== prev, before);
    }
    throw new Error("Questionnaire didn't reach the end page");
}

export async function expectResult(page, title) {
    await expect(page.getByRole("heading", { name: `SNAP: ${title}` })).toBeVisible();
}

export const TITLES = {
    eligible: "Your household appears to qualify",
    needs: "We need a little more information",
    notEligible: "Your household may not qualify",
};

// Fixture /api/extract responses
export const ID_JANE = {
    documentType: "id",
    fields: {
        primary_address: "123 Main St, Queens, NY 11101",
        household_members: [{ first_name: "Jane", last_name: "Test", dob: "1990-01-31", sex: "F", is_applicant: true, relationship_to_applicant: "Self" }],
        incomes: null, shelter: null, assets: null,
    },
    issues: [],
};
export const PAYSTUB_JANE = (gross, frequency = "monthly") => ({
    documentType: "pay_stub",
    fields: {
        household_members: [{ first_name: "Jane", last_name: "Test", is_applicant: true }],
        incomes: [{ individual_name: "Jane Test", employer_or_source_name: "ACME Cafe", income_type: "wages", gross_amount: gross, frequency, hours_worked_per_month: 80, employment_type: "employed" }],
        shelter: null, assets: null,
    },
    issues: [],
});
export const BIRTH_CERT_LEO = {
    documentType: "birth_certificate",
    fields: {
        household_members: [
            { first_name: "Leo", last_name: "Test", dob: "2018-05-02", sex: "M", is_applicant: true, relationship_to_applicant: "Self" },
            { first_name: "Jane", last_name: "Test" },
        ],
        incomes: null, shelter: null, assets: null,
    },
    issues: [],
};
