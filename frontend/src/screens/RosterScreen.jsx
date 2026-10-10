import { useContext, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import { DOCUMENT_TYPES } from "../data/documentTypes.js";
import { addPerson, confirmRoster, removePerson } from "../utils/applicantEdits.js";
import { memberLabel } from "../utils/questionQueue.js";

// Who lives with the applicant. People found in documents are listed for the
// applicant to keep or remove (e.g. a duplicate, or a roommate who moved out);
// anyone missing can be added. Everything else about each person is asked on
// the question screen.
export default function RosterScreen({ goNext }) {
    const { applicant, setApplicant, documents } = useContext(BridgeContext);
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");

    function sourceLabel(member) {
        if (!member._upload_id) return null;
        const doc = documents.find((d) => d.id === member._upload_id);
        const label = doc && DOCUMENT_TYPES[doc.type]?.label;
        return label ? `Found on your ${label.toLowerCase()}` : "Found on a document you uploaded";
    }

    function handleAdd(e) {
        e.preventDefault();
        if (!firstName.trim()) return;
        setApplicant((prev) => addPerson(prev, firstName, lastName));
        setFirstName("");
        setLastName("");
    }

    function handleContinue() {
        setApplicant((prev) => confirmRoster(prev));
        goNext();
    }

    return (
        <div>
            <h1>Who lives with you?</h1>
            <p>
                List everyone who lives with you, even if they are not applying. If someone is listed twice,
                or doesn't live with you, remove them.
            </p>

            <ul>
                {applicant.household_members.map((member) => (
                    <li key={member.id}>
                        {memberLabel(member)}
                        {sourceLabel(member) && <> ({sourceLabel(member)})</>}
                        {member.is_applicant.value !== true && (
                            <>
                                {" "}
                                <button onClick={() => setApplicant((prev) => removePerson(prev, member.id))}>
                                    Remove
                                </button>
                            </>
                        )}
                    </li>
                ))}
            </ul>

            <form onSubmit={handleAdd}>
                <h2>Add someone</h2>
                <label>
                    First name
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </label>
                <label>
                    Last name
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </label>
                <button type="submit" disabled={!firstName.trim()}>
                    Add person
                </button>
            </form>

            <button onClick={handleContinue}>Continue</button>
        </div>
    );
}
