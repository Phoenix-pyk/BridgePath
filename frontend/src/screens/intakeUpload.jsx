import { useContext, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import { CATEGORIES, DOCUMENT_TYPES } from "../data/documentTypes.js";
import { pickFile } from "../utils/documentScanner.js";
import { extract } from "../utils/api.js";
import { mergeExtraction } from "../utils/mergeExtraction.js";

export default function IntakeUpload({ goNext }) {
    const { documents, fixing, setApplicant, setDocuments, setQuestionQueue } =
        useContext(BridgeContext);

    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    // When fixing, only show the documents that need to be re-uploaded
    const isFixing = fixing && fixing.type === "document";
    const checklist = isFixing ? fixing.items : Object.keys(DOCUMENT_TYPES);

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

            // Reject unrecognized documents ("other"), or, when fixing, anything
            // that isn't one of the documents being re-uploaded
            if (!checklist.includes(response.documentType)) {
                if (isFixing) {
                    const expected = checklist.map((d) => DOCUMENT_TYPES[d]?.label).join(" or ");
                    setError(`This looks like a ${DOCUMENT_TYPES[response.documentType]?.label ?? "different document"}. Please upload your ${expected}.`);
                } else {
                    setError("We couldn't recognize this document. Please upload one of the documents listed above.");
                }
                return;
            }

            // Add this document's data to the household profile without
            // overwriting answers from earlier documents
            setApplicant((prev) => mergeExtraction(prev, response.fields, response.documentType));

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
        // TODO: build the queue from the fields documents didn't fill once
        // QuestionBank.json is migrated to the nested applicant shape
        setQuestionQueue([]);
        goNext();
    }

    return (
        <div>
            <h1>Upload your documents</h1>
            {!isFixing && (
                <p>Upload any of these that you have. The more you upload, the fewer questions we'll ask.</p>
            )}

            {CATEGORIES.map((category) => {
                const items = checklist.filter((item) => DOCUMENT_TYPES[item]?.category === category);
                if (items.length === 0) return null;
                return (
                    <section key={category}>
                        <h2>{category}</h2>
                        <ul>
                            {items.map((item) => {
                                const doc = documents.find((d) => d.type === item);
                                return (
                                    <li key={item}>
                                        {DOCUMENT_TYPES[item].label}
                                        {doc && doc.status === "ok" && " ✓"}
                                        {doc && doc.status === "flagged" && (
                                            <>
                                                {" "}⚠️ Needs attention
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
                    </section>
                );
            })}

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
