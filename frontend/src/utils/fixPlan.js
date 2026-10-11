// frontend/src/utils/fixPlan.js
//
// Turns one item of /api/eligibility's `missing` list into what the results
// screen shows for it: readable text, plus the `fixing` value for an "Answer"
// button (QuestionScreen) and/or an "Upload" button (IntakeUpload). See the
// `fixing` shapes in App.jsx / intakeUpload.jsx.

import { FIELD_DOCUMENTS, PROOF } from "../data/fixSources.js";
import { isAnswered } from "./applicantModel.js";
import { findQuestionForPath, getIn, getRows, memberLabel, questionText, splitPath } from "./questionQueue.js";

// Which question pages answer a missing path (one per income/asset row that's still empty)
function answerItems(applicant, found, path, member) {
    const { qid, entry } = found;
    if (entry.scope === "member") return member ? [{ qid, memberId: member.id }] : [];
    if (entry.scope === "household") return [{ qid }];
    // Row scopes: rows still missing this field, for this person if one is named
    const field = path.split(".").slice(1).join(".");
    return getRows(applicant, entry.scope)
        .filter((row) => !isAnswered(getIn(row, splitPath(field))))
        .filter((row) => !member || row.member_id.value === member.id)
        .map((row) => ({ qid, rowId: row.id }));
}

// m = { type: "question" | "document", item, memberIndex }
// → { text, answer: fixing | null, upload: fixing | null }
export function planFix(applicant, m) {
    const member = m.memberIndex != null ? applicant.household_members[m.memberIndex] ?? null : null;
    const forWhom = member ? ` (for ${memberLabel(member)})` : "";

    if (m.type === "document") {
        const proof = PROOF[m.item];
        const text = (proof?.label ?? m.item.replaceAll("_", " ")) + forWhom;
        const upload = proof?.documents.length
            ? { type: "document", items: proof.documents, memberId: member?.id ?? null, proof: true, reason: text }
            : null;
        return { text, answer: null, upload };
    }

    if (m.item === "household_members") return { text: "Who lives in your household", answer: null, upload: null };

    const found = findQuestionForPath(m.item);
    let text = m.item;
    if (found?.item) text = member ? `${memberLabel(member)}: ${found.item.label}?` : `${found.item.label}?`;
    else if (found) text = found.entry.scope === "member" ? questionText(found.entry, member) : questionText(found.entry) + forWhom;

    const items = found ? answerItems(applicant, found, m.item, member) : [];
    const docs = FIELD_DOCUMENTS[m.item];
    return {
        text,
        answer: items.length ? { type: "question", items } : null,
        upload: docs ? { type: "document", items: docs, memberId: member?.id ?? null, reason: text } : null,
    };
}

// One "Answer all of these" fixing value covering every answerable item
export function answerAll(plans) {
    const items = [];
    const seen = new Set();
    for (const plan of plans) {
        for (const item of plan.answer?.items ?? []) {
            const key = `${item.qid}:${item.memberId ?? item.rowId ?? ""}`;
            if (!seen.has(key)) {
                seen.add(key);
                items.push(item);
            }
        }
    }
    return items.length ? { type: "question", items } : null;
}
