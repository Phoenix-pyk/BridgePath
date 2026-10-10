import { useContext, useEffect, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import { checkEligibility } from "../utils/api.js";
import { findQuestionForPath, memberLabel, questionText } from "../utils/questionQueue.js";

// Plain-language names for the proof eligibility asks for (factor names from
// backend/app/services/document_requirements.py)
const PROOF_LABELS = {
    earned_income_employer: "Proof of job income, like recent pay stubs or a letter from the employer",
    earned_income_self_employment: "Proof of self-employment income, like business records or a tax return",
    income_from_rent_or_room_board: "Proof of rent paid to you by a roomer or boarder",
    unearned_income_social_security: "Your Social Security or SSI award letter",
    unearned_income_veterans_benefits: "Your veterans benefits letter",
    unearned_income_uib: "Your unemployment benefits letter",
    unearned_income_workers_compensation: "Your workers' compensation letter",
    unearned_income_child_support: "Proof of child support you receive",
    unearned_income_private_pension: "Your pension or annuity statement",
    unearned_income_education_grants: "Your financial aid award letter",
};

const STATUS_TITLES = {
    eligible: "Your household appears to qualify",
    needs_something: "We need a little more information",
    not_eligible: "Your household may not qualify",
};

function describeMissing(applicant, m) {
    const person = m.memberIndex != null ? applicant.household_members[m.memberIndex] : null;
    if (m.type === "document") {
        const proof = PROOF_LABELS[m.item] ?? m.item.replaceAll("_", " ");
        return person ? `${proof} (for ${memberLabel(person)})` : proof;
    }
    if (m.item === "household_members") return "Who lives in your household";
    const found = findQuestionForPath(m.item);
    if (!found) return m.item;
    if (found.item) {
        // One line of a checklist, e.g. "Gets disability benefits (...)"
        return person ? `${memberLabel(person)}: ${found.item.label}?` : `${found.item.label}?`;
    }
    const text = questionText(found.entry, found.entry.scope === "member" ? person : null);
    return person && found.entry.scope !== "member" ? `${text} (${memberLabel(person)})` : text;
}

// Sends the finished applicant to /api/eligibility (through api.js) every
// time it opens, and shows the result. "Try again" re-runs the check.
export default function ResultsScreen({ goNext, goBack }) {
    const { applicant, results, setResults } = useContext(BridgeContext);
    const [status, setStatus] = useState("loading"); // loading | done | error
    const [error, setError] = useState(null);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setStatus("loading");
        checkEligibility(applicant)
            .then((response) => {
                if (cancelled) return;
                setResults(response.results);
                setStatus("done");
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err.message);
                setStatus("error");
            });
        return () => {
            cancelled = true;
        };
        // Check once per visit (and per "Try again"), not on every applicant change
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt]);

    if (status === "loading") {
        return (
            <div>
                <h1>Checking your answers...</h1>
            </div>
        );
    }

    if (status === "error") {
        return (
            <div>
                <h1>We couldn't check your eligibility</h1>
                <p>{error}</p>
                <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
                <button onClick={goBack}>Back to questions</button>
            </div>
        );
    }

    const needsSomething = results.some((r) => r.status === "needs_something");

    return (
        <div>
            {results.map((result) => (
                <section key={result.benefit}>
                    <h1>{result.benefit}: {STATUS_TITLES[result.status] ?? result.status}</h1>
                    <p>{result.reason}</p>

                    {result.missing.length > 0 && (
                        <ul>
                            {result.missing.map((m) => (
                                <li key={`${m.type}:${m.item}:${m.memberIndex}`}>{describeMissing(applicant, m)}</li>
                            ))}
                        </ul>
                    )}

                    {result.status === "not_eligible" && (
                        <p>
                            This is only an estimate. You still have the right to apply, and your local office
                            makes the final decision.
                        </p>
                    )}
                </section>
            ))}

            <p>
                This is a screening, not a decision. Your local social services office decides after your
                application and interview.
            </p>

            {needsSomething && <button onClick={goBack}>Answer the remaining questions</button>}
            <button onClick={() => setAttempt((n) => n + 1)}>Check again</button>
            <button onClick={goNext}>Continue to my application forms</button>
        </div>
    );
}
