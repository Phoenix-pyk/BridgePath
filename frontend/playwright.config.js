// Browser tests for the whole intake flow (npm run test:e2e).
// They click through the real app against the real backend's eligibility
// rules; document uploads are answered with fixtures (no Gemini calls).
// The HTML report (npm run test:e2e:report) shows a screenshot of every step.

import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const backendUvicorn = existsSync("../backend/venv/bin/uvicorn") ? "venv/bin/uvicorn" : "uvicorn";

export default defineConfig({
    testDir: "tests/e2e",
    outputDir: "tests/e2e/results",
    fullyParallel: true,
    retries: 0,
    reporter: [["list"], ["html", { outputFolder: "tests/e2e/report", open: "never" }]],
    use: {
        baseURL: "http://localhost:5173",
        trace: "on",            // step-by-step timeline with DOM snapshots, viewable in the report
        screenshot: "on",
        viewport: { width: 1000, height: 900 },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1000, height: 900 } } }],
    webServer: [
        {
            command: `cd ../backend && ${backendUvicorn} app.main:app --port 8000`,
            url: "http://localhost:8000/docs",
            reuseExistingServer: true,
            timeout: 60_000,
        },
        {
            command: "npm run dev -- --port 5173 --strictPort",
            url: "http://localhost:5173",
            reuseExistingServer: true,
            timeout: 60_000,
        },
    ],
});
