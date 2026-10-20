import { useContext, useState } from "react";
import { BridgeContext } from "../../context/BridgeContext.jsx";
import { CATEGORIES, DOCUMENT_TYPES } from "../../data/documentTypes.js";
import { pickFile, pickFiles } from "../../utils/documentScanner.js";
import { extract } from "../../utils/api.js";
import { mergeExtraction, removeUploads, replaceTypedIncomes } from "../../utils/mergeExtraction.js";
import { findMember, memberLabel } from "../../utils/questionQueue.js";
import "./intakeUpload.css";

// Fixing mode (fixing.type === "document", from the results screen):
//   fixing = { type: "document", items: [documentTypes], reason?, memberId?, proof?, replace? }
// Only those document types are accepted. memberId: the upload fills that
// person's missing details instead of adding new people. proof: the upload
// proves income the user typed, so it replaces that typed income. replace:
// it replaces earlier uploads of the same type (re-uploading a flagged document).
export default function IntakeUpload({ goNext }) {
    const { applicant, documents, fixing, setApplicant, setDocuments } = useContext(BridgeContext);

    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(null); // { index, total, name } while reading
    const [problems, setProblems] = useState([]);   // [{ name, message }] from the last upload
    const [readCount, setReadCount] = useState(0);  // documents read in the last upload

    // When fixing, only show the documents that can fix what's missing
    const isFixing = fixing && fixing.type === "document";
    const fixingFor = isFixing && fixing.memberId ? findMember(applicant, fixing.memberId) : null;
    const checklist = isFixing ? fixing.items : Object.keys(DOCUMENT_TYPES);

    // Read one file and add it to the household. Returns null on success or
    // a message to show for this file.
    async function readFile(file, previousDocuments) {
        try {
            const response = await extract(file);
            // response = { documentType, fields, issues }

            // Reject unrecognized documents ("other"), or, when fixing, anything
            // that isn't one of the documents being re-uploaded
            if (!checklist.includes(response.documentType)) {
                if (isFixing) {
                    const expected = checklist.map((d) => DOCUMENT_TYPES[d]?.label).join(" or ");
                    return `This looks like a ${DOCUMENT_TYPES[response.documentType]?.label ?? "different document"}. Please upload your ${expected}.`;
                }
                return "We couldn't recognize this document. Please upload one of the documents listed above.";
            }

            // Normally an upload is added alongside earlier ones of the same type
            // (e.g. two children's birth certificates); fixing.replace swaps out
            // the uploads that existed before this batch.
            const uploadId = crypto.randomUUID();
            const replacedIds = isFixing && fixing.replace
                ? previousDocuments.filter((doc) => doc.type === response.documentType).map((doc) => doc.id)
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
            return null;
        } catch (err) {
            // api.js gives "Can't reach server" or the backend's own (PII-free) message,
            // e.g. "Couldn't read this file, try again."
            return err.message || "Couldn't read this file, try again.";
        }
    }

    // Upload file: pick one or more files. Take photo: one picture.
    // Files are read one after another (one Gemini call each, no burst of
    // requests); a file that fails doesn't stop the rest.
    async function handleUpload(useCamera) {
        let files;
        let rejected = [];
        try {
            if (useCamera) {
                const photo = await pickFile(true);
                files = photo ? [photo] : null;
            } else {
                const picked = await pickFiles();
                files = picked?.files ?? null;
                rejected = picked?.rejected ?? [];
            }
        } catch (err) {
            setProblems([{ name: "Photo", message: err.message }]); // wrong type or too big
            setReadCount(0);
            return;
        }
        if (!files) return; // user cancelled

        setUploading(true);
        const found = rejected.map((r) => ({ name: r.name, message: r.reason }));
        let read = 0;
        for (const [i, file] of files.entries()) {
            setProgress({ index: i + 1, total: files.length, name: file.name });
            const message = await readFile(file, documents);
            if (message) found.push({ name: file.name, message });
            else read += 1;
        }
        setProgress(null);
        setProblems(found);
        setReadCount(read);
        setUploading(false);
    }

    function handleContinue() {
        goNext();
    }

    return (
        <div className="upload">
            <h1>{isFixing ? "Upload a document" : "Upload your documents"}</h1>
            {isFixing && fixing.reason && <p className="helper">{fixing.reason}</p>}
            {fixingFor && <p className="helper">This is for {memberLabel(fixingFor)}.</p>}
            {!isFixing && (
                <p className="helper">Upload any of these that you have. The more you upload, the fewer questions we'll ask.</p>
            )}

            <div className="upload-area">
                <button className="btn-primary" disabled={uploading} onClick={() => handleUpload(false)}>
                    Upload files
                </button>
                <button disabled={uploading} onClick={() => handleUpload(true)}>
                    Take photo
                </button>
                <p className="helper">You can select several files at once.</p>
            </div>

            {progress && (
                <p className="upload-progress" role="status">
                    <span className="spinner" aria-hidden="true" />
                    Reading document {progress.index} of {progress.total}: {progress.name}...
                </p>
            )}
            {!uploading && readCount > 1 && <p className="upload-read">{readCount} documents read ✓</p>}
            {!uploading && problems.length > 0 && (
                <div className="error">
                    <p>{problems.length === 1 ? "One file wasn't added:" : `${problems.length} files weren't added:`}</p>
                    <ul>
                        {problems.map((p, i) => (
                            <li key={`${p.name}-${i}`}>{p.name}: {p.message}</li>
                        ))}
                    </ul>
                </div>
            )}

            {CATEGORIES.map((category) => {
                const items = checklist.filter((item) => DOCUMENT_TYPES[item]?.category === category);
                if (items.length === 0) return null;
                return (
                    <section key={category}>
                        <h2>{category}</h2>
                        <ul className="doc-list">
                            {items.map((item) => {
                                const uploads = documents.filter((d) => d.type === item);
                                const issues = [...new Set(uploads.flatMap((d) => d.issues))];
                                return (
                                    <li key={item} className="doc-row">
                                        <span className="doc-name">
                                            {DOCUMENT_TYPES[item].label}
                                            {uploads.length > 1 && ` (${uploads.length})`}
                                        </span>
                                        {uploads.length === 0 && <span className="badge badge-missing">Missing</span>}
                                        {uploads.length > 0 && issues.length === 0 && <span className="badge badge-done">✓ Done</span>}
                                        {issues.length > 0 && (
                                            <>
                                                <span className="badge badge-attention">⚠️ Needs attention</span>
                                                <ul className="doc-issues">
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

            <div className="actions">
                <button className="btn-primary" disabled={uploading} onClick={handleContinue}>
                    {isFixing ? "Back to my results" : "Continue"}
                </button>
            </div>
        </div>
    );
}
