import { useContext, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import QuestionBank from "../data/QuestionBank.json";
import { pickFile } from "../utils/documentScanner.js";
import { extract } from "../utils/api.js";

const DOC_LABELS = {
    id: "Photo ID",
    pay_stub: "Pay stub",
    lease: "Lease",
    aid_letter: "Financial aid letter",
};

export default function IntakeUpload({ goNext }) {
    const { fields, documents, fixing, setFields, setDocuments, setQuestionQueue } =
        useContext(BridgeContext);

    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    // When fixing, only show the documents that need to be re-uploaded
    const checklist =
        fixing && fixing.type === "document"
            ? fixing.items
            : ["id", "pay_stub", "lease", "aid_letter"];

    async function handleUpload(useCamera) {
        let image;
        try {
            image = await pickFile(useCamera);
        } catch (err) {
            setError(err.message); // wrong type or too big
            return;
        }
        if (!image) return; // user cancelled

        setUploading(true);
        setError(null);
        try {
            const response = await extract(image);
            // response = { documentType, fields, issues }

            // Reject documents that aren't on the checklist (e.g. a pay stub while fixing a lease)
            if (!checklist.includes(response.documentType)) {
                const expected = checklist.map((d) => DOC_LABELS[d]).join(" or ");
                setError(`This looks like a ${DOC_LABELS[response.documentType] ?? "different document"}. Please upload your ${expected}.`);
                return;
            }

            // Fill in empty fields only, so answers from earlier documents aren't overwritten
            setFields((prev) => {
                const next = { ...prev };
                for (const [name, value] of Object.entries(response.fields)) {
                    if (next[name] && next[name].value === null) {
                        next[name] = { value, source: "document" };
                    }
                }
                return next;
            });

            // Replace any earlier upload of the same document type
            setDocuments((prev) => [
                ...prev.filter((doc) => doc.type !== response.documentType),
                {
                    type: response.documentType,
                    status: response.issues.length === 0 ? "ok" : "flagged",
                    issues: response.issues,
                },
            ]);
        } catch (err) {
            setError("Couldn't read this file, try again.");
        } finally {
            setUploading(false);
        }
    }

    function handleContinue() {
        // Ask only about fields the documents didn't fill in, in QuestionBank order
        const queue = Object.keys(QuestionBank).filter(
            (name) => fields[name].value === null
        );
        setQuestionQueue(queue);
        goNext();
    }

    return (
        <div>
            <h1>Upload your documents</h1>

            <ul>
                {checklist.map((item) => {
                    const doc = documents.find((d) => d.type === item);
                    return (
                        <li key={item}>
                            {DOC_LABELS[item]}:{" "}
                            {!doc && "Not uploaded yet"}
                            {doc && doc.status === "ok" && "✓"}
                            {doc && doc.status === "flagged" && (
                                <>
                                    ⚠️ Needs attention
                                    <ul>
                                        {doc.issues.map((issue) => (
                                            <li key={issue}>{issue}</li>
                                        ))}
                                    </ul>
                                </>
                            )}
                        </li>
                    );
                })}
            </ul>

            <button disabled={uploading} onClick={() => handleUpload(false)}>
                Upload file
            </button>
            <button disabled={uploading} onClick={() => handleUpload(true)}>
                Take photo
            </button>

            {uploading && <p>Reading your document...</p>}
            {error && <p>{error}</p>}

            <button disabled={uploading} onClick={handleContinue}>
                Continue
            </button>
        </div>
    );
}

