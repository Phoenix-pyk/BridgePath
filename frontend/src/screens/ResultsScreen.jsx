import { useContext, useEffect, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import { checkEligibility } from "../utils/api.js";
import { DOCUMENT_TYPES } from "../data/documentTypes.js";
import { answerAll, planFix } from "../utils/fixPlan.js";

const STATUS_TITLES = {
    eligible: "Your household appears to qualify",
    needs_something: "We need a little more information",
    not_eligible: "Your household may not qualify",
};

function uploadLabel(fix) {
    const names = fix.items.map((d) => DOCUMENT_TYPES[d]?.label.toLowerCase() ?? d);
    return names.length > 3 ? "Upload a document" : `Upload ${names.join(" or ")}`;
}

// Sends the finished applicant to /api/eligibility (through api.js) every
// time it opens, and shows the result. Each missing item gets "Answer" and/or
// "Upload" buttons (onFix → App sends the user to fix it, then back here,
// which checks again).
export default function ResultsScreen({ goNext, goBack, onFix }) {
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
    const plans = results.flatMap((r) => r.missing.map((m) => ({ m, plan: planFix(applicant, m) })));
    const fixAllAnswers = answerAll(plans.map((p) => p.plan));

    return (
        <div>
            {results.map((result) => (
                <section key={result.benefit}>
                    <h1>{result.benefit}: {STATUS_TITLES[result.status] ?? result.status}</h1>
                    <p>{result.reason}</p>

                    {result.missing.length > 0 && (
                        <ul>
                            {result.missing.map((m) => {
                                const plan = planFix(applicant, m);
                                return (
                                    <li key={`${m.type}:${m.item}:${m.memberIndex}`}>
                                        {plan.text}{" "}
                                        {plan.answer && <button onClick={() => onFix(plan.answer)}>Answer</button>}
                                        {plan.upload && <button onClick={() => onFix(plan.upload)}>{uploadLabel(plan.upload)}</button>}
                                    </li>
                                );
                            })}
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

            {fixAllAnswers && fixAllAnswers.items.length > 1 && (
                <button onClick={() => onFix(fixAllAnswers)}>Answer all of these</button>
            )}
            {needsSomething && <button onClick={goBack}>Go through all the questions</button>}
            <button onClick={() => setAttempt((n) => n + 1)}>Check again</button>
            <button onClick={goNext}>Continue to my application forms</button>
        </div>
    );
}
