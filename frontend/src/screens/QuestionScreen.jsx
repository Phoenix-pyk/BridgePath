import { useContext, useState } from "react";
import { BridgeContext } from "../context/BridgeContext.jsx";
import { addRow, applyAnswer } from "../utils/applicantEdits.js";
import {
    QUESTION_BANK, SECTION_LABELS, findMember, findRow, getIn, itemKey, listItems, memberLabel, pickPage,
    questionText, splitPath, whoFlagMembers,
} from "../utils/questionQueue.js";

const ADD_ANOTHER_TEXT = {
    hasIncome: "Does anyone in your household get any other income?",
    hasMoreIncome: "Does anyone in your household get any other income?",
    hasCashOrAccounts: "Is there any other cash or bank account to add?",
    hasFinancialAssets: "Are there any other savings or investments to add?",
    hasVehicles: "Is there another vehicle to add?",
    paysChildSupport: "Does anyone pay any other child support?",
};

// Asks the QuestionBank questions one page at a time. Every question that
// applies is a numbered page (answered ones too, so they can be reviewed);
// answering moves to the next unanswered one. The pages are rebuilt from
// `applicant` after every answer, so answers change what's asked
// (e.g. "yes, I'm a student" adds the student questions).
export default function QuestionScreen({ goNext }) {
    const { applicant, setApplicant } = useContext(BridgeContext);
    const [skipped, setSkipped] = useState(() => new Set());     // "Skip for now"
    const [doneAdding, setDoneAdding] = useState(() => new Set()); // addRows questions the user finished
    const [view, setView] = useState({ type: "next", from: 0, lastKey: null }); // see pickPage

    const items = listItems(applicant, { doneAdding });
    const pageIndex = pickPage(items, view, skipped);
    const current = pageIndex === -1 ? null : items[pageIndex];
    const unanswered = items.filter((i) => !i.answered).length;

    function goToPage(index) {
        if (index >= items.length) setView({ type: "end" });
        else setView({ type: "page", key: itemKey(items[index]), index });
    }

    function moveOn(item) {
        setView({ type: "next", from: pageIndex, lastKey: itemKey(item) });
    }

    function handleAnswer(item, value) {
        if (item.kind === "addAnother") {
            if (value) {
                setApplicant((prev) => addRow(prev, item.qid));
                setDoneAdding((prev) => new Set([...prev].filter((q) => q !== item.qid)));
            } else {
                setDoneAdding((prev) => new Set(prev).add(item.qid));
            }
        } else {
            setApplicant((prev) => applyAnswer(prev, item, value));
        }
        moveOn(item);
    }

    function handleSkip(item) {
        setSkipped((prev) => new Set(prev).add(itemKey(item)));
        moveOn(item);
    }

    const pager = (
        <Pagination
            items={items}
            current={pageIndex === -1 ? items.length : pageIndex}
            onGo={goToPage}
        />
    );

    if (!current) {
        const firstUnanswered = items.findIndex((i) => !i.answered);
        return (
            <div>
                <h1>{unanswered === 0 ? "That's everything" : "You're at the end"}</h1>
                {unanswered > 0 && (
                    <p>
                        {unanswered} question{unanswered === 1 ? " is" : "s are"} still unanswered. You can see
                        your results now, but we may need those answers to check your eligibility.
                    </p>
                )}
                {unanswered > 0 && <button onClick={() => goToPage(firstUnanswered)}>Go to first unanswered</button>}
                <button disabled={items.length === 0} onClick={() => goToPage(items.length - 1)}>Back</button>
                <button onClick={goNext}>See my results</button>
                {pager}
            </div>
        );
    }

    return (
        <div>
            <p>
                Question {pageIndex + 1} of {items.length} · {SECTION_LABELS[current.section]} · {unanswered} left
            </p>
            <Question
                key={itemKey(current)}
                item={current}
                applicant={applicant}
                onAnswer={(value) => handleAnswer(current, value)}
                onSkip={() => handleSkip(current)}
            />
            <button disabled={pageIndex === 0} onClick={() => goToPage(pageIndex - 1)}>Back</button>
            {pager}
        </div>
    );
}

// « 1 … 32 33 [34] 35 36 … 92 End »  (✓ = answered). Page `items.length` is the end page.
function Pagination({ items, current, onGo }) {
    const last = items.length; // the end page
    const pages = new Set([0, last - 1, current - 2, current - 1, current, current + 1, current + 2]);
    const shown = [...pages].filter((p) => p >= 0 && p < last).sort((a, b) => a - b);

    const buttons = [];
    shown.forEach((p, i) => {
        if (i > 0 && p - shown[i - 1] > 1) buttons.push(<span key={`gap${p}`}> … </span>);
        buttons.push(
            <button key={p} onClick={() => onGo(p)} disabled={p === current} aria-current={p === current ? "page" : undefined}>
                {p === current ? `[${p + 1}]` : p + 1}
                {items[p].answered && " ✓"}
            </button>
        );
    });

    return (
        <nav aria-label="Question pages">
            <button onClick={() => onGo(current - 1)} disabled={current === 0}>«</button>
            {buttons}
            <button onClick={() => onGo(last)} disabled={current === last} aria-current={current === last ? "page" : undefined}>
                End
            </button>
            <button onClick={() => onGo(current + 1)} disabled={current === last}>»</button>
        </nav>
    );
}

function subjectLabel(item, applicant) {
    if (item.scope === "member") return memberLabel(findMember(applicant, item.memberId));
    if (item.kind === "addAnother" || !item.rowId) return null;
    const row = findRow(applicant, item.scope, item.rowId);
    if (item.scope === "income") {
        const who = findMember(applicant, row.member_id.value);
        return ["Income", row.employer_or_source_name.value, who && `for ${memberLabel(who)}`].filter(Boolean).join(" · ");
    }
    if (item.scope === "asset") {
        const type = row.resource_type.value;
        return type === "vehicle" ? "Vehicle" : "Account or savings";
    }
    return "Child support payment";
}

// The answer already stored for an item (shown when going Back)
function currentValue(item, entry, applicant) {
    if (item.kind === "addAnother") return null;
    if (entry.input === "whoFlag") {
        return whoFlagMembers(applicant, entry).filter((m) => m[entry.path].value === true).map((m) => m.id);
    }
    const base = item.scope === "member" ? findMember(applicant, item.memberId)
        : item.rowId ? findRow(applicant, item.scope, item.rowId) : applicant;
    const target = getIn(base, splitPath(entry.path));
    if (entry.input === "who") return { answer: target.answer.value, who: target.who.value || [] };
    return target?.value ?? null;
}

function Question({ item, applicant, onAnswer, onSkip }) {
    const entry = QUESTION_BANK[item.qid];
    const subject = subjectLabel(item, applicant);

    if (item.kind === "addAnother") {
        return (
            <div>
                <h1>{ADD_ANOTHER_TEXT[item.qid] ?? "Add another?"}</h1>
                <YesNo onAnswer={onAnswer} />
            </div>
        );
    }

    const member = item.scope === "member" ? findMember(applicant, item.memberId) : null;
    let options = entry.options;
    if (item.scope === "asset" && entry.path === "resource_type") {
        const types = findRow(applicant, "asset", item.rowId)?._row_types;
        if (types) options = options.filter((o) => types.includes(o.value));
    }

    return (
        <div>
            {subject && <p>{subject}</p>}
            <h1>{questionText(entry, member)}</h1>
            {entry.explanation && <p>{entry.explanation}</p>}
            {entry.example && <p>Example: {entry.example}</p>}

            <AnswerInput
                entry={entry}
                options={options}
                applicant={applicant}
                initial={currentValue(item, entry, applicant)}
                onAnswer={onAnswer}
            />

            {entry.skipValue !== undefined && (
                <button onClick={() => onAnswer(entry.skipValue)}>{entry.skipLabel}</button>
            )}
            <button onClick={onSkip}>Skip for now</button>
        </div>
    );
}

function YesNo({ onAnswer }) {
    return (
        <div>
            <button onClick={() => onAnswer(true)}>Yes</button>
            <button onClick={() => onAnswer(false)}>No</button>
        </div>
    );
}

function MemberChecklist({ members, chosen, setChosen }) {
    function toggle(id) {
        setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }
    return (
        <div>
            {members.map((m) => (
                <label key={m.id}>
                    <input type="checkbox" checked={chosen.includes(m.id)} onChange={() => toggle(m.id)} />
                    {memberLabel(m)}
                </label>
            ))}
        </div>
    );
}

function AnswerInput({ entry, options, applicant, initial, onAnswer }) {
    const members = applicant.household_members;
    const [text, setText] = useState(
        Array.isArray(initial) && entry.input === "list" ? initial.join("\n")
            : initial !== null && typeof initial !== "object" && initial !== "declined" ? String(initial) : ""
    );
    const [chosen, setChosen] = useState(
        Array.isArray(initial) ? initial : initial && Array.isArray(initial.who) ? initial.who : []
    );
    const [whoYes, setWhoYes] = useState(initial?.answer === true);

    switch (entry.input) {
        case "yesno":
            return <YesNo onAnswer={onAnswer} />;

        case "select":
            return (
                <div>
                    {options.map((o) => (
                        <button key={o.value} onClick={() => onAnswer(o.value)}>{o.label}</button>
                    ))}
                </div>
            );

        case "member":
            return (
                <div>
                    {members.map((m) => (
                        <button key={m.id} onClick={() => onAnswer(m.id)}>{memberLabel(m)}</button>
                    ))}
                </div>
            );

        case "multiselect":
            return (
                <div>
                    {options.map((o) => (
                        <label key={o.value}>
                            <input
                                type="checkbox"
                                checked={chosen.includes(o.value)}
                                onChange={() => setChosen((prev) =>
                                    prev.includes(o.value) ? prev.filter((v) => v !== o.value) : [...prev, o.value]
                                )}
                            />
                            {o.label}
                        </label>
                    ))}
                    <button disabled={chosen.length === 0} onClick={() => onAnswer(chosen)}>Continue</button>
                </div>
            );

        case "members":
            return (
                <div>
                    <MemberChecklist members={members} chosen={chosen} setChosen={setChosen} />
                    <button disabled={chosen.length === 0} onClick={() => onAnswer(chosen)}>Continue</button>
                </div>
            );

        case "whoFlag":
            return (
                <div>
                    <MemberChecklist members={whoFlagMembers(applicant, entry)} chosen={chosen} setChosen={setChosen} />
                    <button disabled={chosen.length === 0} onClick={() => onAnswer(chosen)}>Continue</button>
                    <button onClick={() => onAnswer([])}>No one</button>
                </div>
            );

        case "who":
            if (!whoYes) {
                return (
                    <div>
                        <button onClick={() => setWhoYes(true)}>Yes</button>
                        <button onClick={() => onAnswer({ answer: false, who: [] })}>No</button>
                    </div>
                );
            }
            return (
                <div>
                    <p>Who?</p>
                    <MemberChecklist members={members} chosen={chosen} setChosen={setChosen} />
                    <button disabled={chosen.length === 0} onClick={() => onAnswer({ answer: true, who: chosen })}>
                        Continue
                    </button>
                </div>
            );

        case "list":
            return (
                <div>
                    <p>One per line</p>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} />
                    <button
                        disabled={!text.trim()}
                        onClick={() => onAnswer(text.split("\n").map((s) => s.trim()).filter(Boolean))}
                    >
                        Continue
                    </button>
                </div>
            );

        case "number":
        case "money": {
            const n = Number(text.replace(/[$,\s]/g, ""));
            const valid = text.trim() !== "" && Number.isFinite(n) && n >= 0;
            return (
                <div>
                    {entry.input === "money" && "$"}
                    <input inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
                    <button disabled={!valid} onClick={() => onAnswer(n)}>Continue</button>
                </div>
            );
        }

        default: {
            // text, longtext, date, phone, ssn, address
            const type = entry.input === "date" ? "date" : entry.input === "phone" ? "tel" : "text";
            return (
                <div>
                    {entry.input === "longtext" || entry.input === "address"
                        ? <textarea value={text} onChange={(e) => setText(e.target.value)} />
                        : <input type={type} value={text} onChange={(e) => setText(e.target.value)} />}
                    <button disabled={!text.trim()} onClick={() => onAnswer(text.trim())}>Continue</button>
                </div>
            );
        }
    }
}
