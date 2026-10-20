import { useContext, useEffect, useState } from "react";
import { BridgeContext } from "../../context/BridgeContext.jsx";
import { createForms } from "../../utils/api.js";
import "./FormsScreen.css";

const STATUS_TEXT = {
    eligible: "appears to qualify",
    needs_something: "may qualify, some information still needed",
    not_eligible: "may not qualify, but you can still apply",
};

// How each file from POST /api/forms is offered (unknown names fall back to "Download <name> (PDF)")
const DOWNLOADS = {
    "LDSS-4826": {
        label: "Download LDSS-4826 (PDF)",
        description: "The official form, filled in. Print it, sign it, and mail it or bring it to your local office.",
    },
    "SNAP-Checklist": {
        label: "Download my checklist (PDF)",
        description: "All your answers in order. Keep it open while you apply online and copy each answer in.",
    },
};

// Turn the backend's base64 PDF into a link the browser can download.
// Everything stays in this tab's memory; nothing is saved anywhere.
function pdfUrl(base64) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

// Last step: fill the official application(s) and the checklist (for applying
// online) from `applicant` through api.createForms → POST /api/forms, let the
// user download them, and offer
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
        <div className="forms">
            <h1>Your application</h1>

            {results.map((r) => (
                <p key={r.benefit} className={`forms-status status-${r.status}`}>
                    {r.benefit}: your household {STATUS_TEXT[r.status] ?? r.status}.
                </p>
            ))}

            {status === "idle" && (
                <>
                    <p>
                        We'll fill out the official New York State SNAP application (LDSS-4826) with your answers and
                        the information from your documents. We'll also make you a checklist of all your answers, so
                        you can copy them in if you'd rather apply online.
                    </p>
                    <div className="actions">
                        <button className="btn-primary" onClick={handleCreate}>Create my application</button>
                    </div>
                </>
            )}

            {status === "loading" && (
                <p className="forms-loading" role="status">
                    <span className="spinner" aria-hidden="true" />
                    Preparing your form and checklist...
                </p>
            )}

            {status === "error" && (
                <>
                    <p className="error">{error}</p>
                    <div className="actions">
                        <button className="btn-primary" onClick={handleCreate}>Try again</button>
                    </div>
                </>
            )}

            {status === "done" && (
                <>
                    {downloads.map((d) => (
                        <div key={d.name} className="forms-download">
                            <a className="link-button" href={d.url} download={`${d.name}.pdf`}>
                                {DOWNLOADS[d.name]?.label ?? `Download ${d.name} (PDF)`}
                            </a>
                            {DOWNLOADS[d.name] && <p className="helper">{DOWNLOADS[d.name].description}</p>}
                        </div>
                    ))}

                    <h2>What to do next</h2>
                    <p>Choose one way to apply:</p>
                    <ol className="steps">
                        <li>
                            <strong>Online:</strong> go to{" "}
                            <a href="https://mybenefits.ny.gov" target="_blank" rel="noreferrer">myBenefits.ny.gov</a>{" "}
                            (or{" "}
                            <a href="https://a069-access.nyc.gov/accesshra" target="_blank" rel="noreferrer">ACCESS HRA</a>{" "}
                            in New York City) and copy your answers from the checklist. Tick each section as you finish it.
                        </li>
                        <li>
                            <strong>On paper:</strong> open the LDSS-4826 and check that everything is right (you can fix
                            anything by hand). Sign and date it on page 8; we leave the signature for you. Then mail it
                            or bring it to your local social services office.
                        </li>
                    </ol>
                    <p>
                        Either way, expect an interview, usually by phone. Have your documents ready; the checklist
                        lists the kinds of proof the office may ask for.
                    </p>
                    <p className="notice">BridgePath does not submit anything for you.</p>
                </>
            )}

            <div className="section">
                <h2>Your information</h2>
                <p>
                    Everything you entered stays only in this browser tab and is gone when you close it. Download your
                    form and checklist first, then you can delete it now.
                </p>
                <button className="btn-danger" onClick={handleDelete}>Delete my information and start over</button>
            </div>
            <div className="actions">
                <button className="btn-link" onClick={goBack}>Back to my results</button>
            </div>
        </div>
    );
}
