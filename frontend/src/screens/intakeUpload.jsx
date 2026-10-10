import { useContext, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import { CATEGORIES, DOCUMENT_TYPES } from "../data/documentTypes.js";
import { pickFile } from "../utils/documentScanner.js";
import { extract } from "../utils/api.js";
import { mergeExtraction, removeUploads, replaceTypedIncomes } from "../utils/mergeExtraction.js";
import { findMember, memberLabel } from "../utils/questionQueue.js";

// Fixing mode (fixing.type === "document", from the results screen):
//   fixing = { type: "document", items: [documentTypes], reason?, memberId?, proof?, replace? }
// Only those document types are accepted. memberId: the upload fills that
// person's missing details instead of adding new people. proof: the upload
// proves income the user typed, so it replaces that typed income. replace:
// it replaces earlier uploads of the same type (re-uploading a flagged document).
export default function IntakeUpload({ goNext }) {
    const { applicant, documents, fixing, setApplicant, setDocuments } = useContext(BridgeContext);

    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    // When fixing, only show the documents that can fix what's missing
    const isFixing = fixing && fixing.type === "document";
    const fixingFor = isFixing && fixing.memberId ? findMember(applicant, fixing.memberId) : null;
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

            // Normally an upload is added alongside earlier ones of the same type
            // (e.g. two children's birth certificates); fixing.replace swaps them out.
            const uploadId = crypto.randomUUID();
            const replacedIds = isFixing && fixing.replace
                ? documents.filter((doc) => doc.type === response.documentType).map((doc) => doc.id)
                : [];
            const targetMemberId = isFixing ? fixing.memberId ?? null : null;

            // Add this document's data to the household profile without
            // overwriting answers from earlier documents
            setApplicant((prev) => {
                const merged = mergeExtraction(removeUploads(prev, replacedIds), response.fields, uploadId, { targetMemberId });
                return isFixing && fixing.proof && targetMemberId
                    ? replaceTypedIncomes(merged, uploadId, targetMemberId)
                    : merged;
            });

            setDocuments((prev) => [
                ...prev.filter((doc) => !replacedIds.includes(doc.id)),
                {
                    id: uploadId,
                    type: response.documentType,
                    status: response.issues.length === 0 ? "ok" : "flagged",
                    issues: response.issues,
                },
            ]);
        } catch (err) {
            // api.js gives "Can't reach server" or the backend's own (PII-free) message,
            // e.g. "Couldn't read this file, try again."
            setError(err.message || "Couldn't read this file, try again.");
        } finally {
            setUploading(false);
        }
    }

    function handleContinue() {
        goNext();
    }

    return (
        <div>
            <h1>{isFixing ? "Upload a document" : "Upload your documents"}</h1>
            {isFixing && fixing.reason && <p>{fixing.reason}</p>}
            {fixingFor && <p>This is for {memberLabel(fixingFor)}.</p>}
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
                                const uploads = documents.filter((d) => d.type === item);
                                const issues = [...new Set(uploads.flatMap((d) => d.issues))];
                                return (
                                    <li key={item}>
                                        {DOCUMENT_TYPES[item].label}
                                        {uploads.length > 1 && ` (${uploads.length})`}
                                        {uploads.length > 0 && issues.length === 0 && " ✓"}
                                        {issues.length > 0 && (
                                            <>
                                                {" "}⚠️ Needs attention
                                                <ul>
                                                    {issues.map((issue) => (
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
                {isFixing ? "Back to my results" : "Continue"}
            </button>
        </div>
    );
}
