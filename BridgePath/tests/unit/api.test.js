// api.js: what's sent to the backend and how errors come back.

import { afterEach, describe, expect, it, vi } from "vitest";
import { field, makeEmptyApplicant } from "../../src/utils/applicantModel.js";
import { checkEligibility, createForms } from "../../src/utils/api.js";

function stubFetch(status, body) {
    const fetch = vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("checkEligibility", () => {
    it("posts the applicant without identifiers eligibility doesn't need", async () => {
        const fetch = stubFetch(200, { results: [] });
        const a = makeEmptyApplicant();
        a.household_members[0].first_name = field("Jane", "user");
        a.household_members[0].ssn = field("123-45-6789", "user");
        a.extra.phone = field("718-555-0100", "user");
        a.primary_address = field("123 Fake St", "document");

        await checkEligibility(a);

        const [url, options] = fetch.mock.calls[0];
        expect(url).toMatch(/\/api\/eligibility$/);
        const sent = options.body;
        expect(sent).not.toContain("123-45-6789");
        expect(sent).not.toContain("718-555");
        expect(sent).not.toContain("Fake St");
        expect(sent).toContain("Jane"); // names stay: eligibility matches incomes by name
        expect(a.household_members[0].ssn.value).toBe("123-45-6789"); // the app's own copy is untouched
    });

    it("passes the backend's error message through", async () => {
        stubFetch(400, { detail: "No information to check." });
        await expect(checkEligibility(makeEmptyApplicant())).rejects.toThrow("No information to check.");
    });

    it("says when the server can't be reached", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
        await expect(checkEligibility(makeEmptyApplicant())).rejects.toThrow("Can't reach server");
    });
});

describe("createForms", () => {
    it("posts the FULL applicant (the form needs SSN, phone and address) and the benefits", async () => {
        const fetch = stubFetch(200, { forms: [] });
        const a = makeEmptyApplicant();
        a.household_members[0].ssn = field("123-45-6789", "user");
        a.extra.phone = field("718-555-0100", "user");
        a.primary_address = field("123 Fake St", "document");

        await createForms(a, ["SNAP"]);

        const [url, options] = fetch.mock.calls[0];
        expect(url).toMatch(/\/api\/forms$/);
        const body = JSON.parse(options.body);
        expect(body.benefits).toEqual(["SNAP"]);
        expect(options.body).toContain("123-45-6789");
        expect(options.body).toContain("718-555-0100");
        expect(options.body).toContain("123 Fake St");
    });

    it("passes the backend's error message through", async () => {
        stubFetch(500, { detail: "Couldn't create your forms, try again." });
        await expect(createForms(makeEmptyApplicant(), ["SNAP"])).rejects.toThrow("Couldn't create your forms, try again.");
    });
});
