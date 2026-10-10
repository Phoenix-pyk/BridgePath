import { useContext, useEffect, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import { createForms } from "../utils/api.js";

const STATUS_TEXT = {
    eligible: "appears to qualify",
    needs_something: "may qualify, some information still needed",
    not_eligible: "may not qualify, but you can still apply",
};

// Turn the backend's base64 PDF into a link the browser can download.
// Everything stays in this tab's memory; nothing is saved anywhere.
function pdfUrl(base64) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

// Last step: fill the official application(s) from `applicant` through
// api.createForms → POST /api/forms, let the user download them, and offer
// to delete everything (the consent screen promises nothing is kept).
export default function FormsScreen({ goBack, onDeleted }) {
    const { applicant, results, setForms, reset } = useContext(BridgeContext);
    const [status, setStatus] = useState("idle"); // idle | loading | done | error
    const [error, setError] = useState(null);
    const [downloads, setDownloads] = useState([]); // [{ name, url }]

    // SNAP's form is offered whatever the screening said: everyone has the right to apply
    const benefits = results.length ? results.map((r) => r.benefit) : ["SNAP"];

    // Free the downloaded files' memory when leaving the screen
    useEffect(() => () => downloads.forEach((d) => URL.revokeObjectURL(d.url)), [downloads]);

    async function handleCreate() {
        setStatus("loading");
        setError(null);
        try {
            const response = await createForms(applicant, benefits);
            setForms(response.forms.map((f) => f.name));
            setDownloads(response.forms.map((f) => ({ name: f.name, url: pdfUrl(f.pdf) })));
            setStatus("done");
        } catch (err) {
            setError(err.message);
            setStatus("error");
        }
    }

    function handleDelete() {
        reset();
        onDeleted();
    }

    return (
        <div>
            <h1>Your application</h1>

            {results.map((r) => (
                <p key={r.benefit}>
                    {r.benefit}: your household {STATUS_TEXT[r.status] ?? r.status}.
                </p>
            ))}

            {status === "idle" && (
                <>
                    <p>
                        We'll fill out the official New York State SNAP application (LDSS-4826) with your answers and
                        the information from your documents.
                    </p>
                    <button onClick={handleCreate}>Create my application</button>
                </>
            )}

            {status === "loading" && <p>Preparing your form...</p>}

            {status === "error" && (
                <>
                    <p>{error}</p>
                    <button onClick={handleCreate}>Try again</button>
                </>
            )}

            {status === "done" && (
                <>
                    {downloads.map((d) => (
                        <p key={d.name}>
                            <a href={d.url} download={`${d.name}.pdf`}>Download {d.name} (PDF)</a>
                        </p>
                    ))}

                    <h2>What to do next</h2>
                    <ol>
                        <li>Open the form and check that everything is right. You can fix anything by hand.</li>
                        <li>Sign and date it on page 8. We leave the signature for you.</li>
                        <li>
                            Submit it: online at myBenefits.ny.gov (or ACCESS HRA in New York City), by mail, or in
                            person at your local social services office.
                        </li>
                        <li>
                            Expect an interview, usually by phone. Have your documents ready; the office will tell
                            you what proof they need.
                        </li>
                    </ol>
                    <p>BridgePath does not submit anything for you.</p>
                </>
            )}

            <h2>Your information</h2>
            <p>
                Everything you entered stays only in this browser tab and is gone when you close it. Download your
                form first, then you can delete it now.
            </p>
            <button onClick={handleDelete}>Delete my information and start over</button>
            <button onClick={goBack}>Back to my results</button>
        </div>
    );
}
