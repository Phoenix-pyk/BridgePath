import { useState } from "react";
import "./ConsentScreen.css";

const consentSections = [
    {
        title: "What we collect",
        text: "The documents you upload and your answers to our questions.",
    },
    {
        title: "Why we collect it",
        text: "To estimate whether you qualify and to fill out your application form.",
    },
    {
        title: "Who else sees it",
        text: "Your documents are sent to Google's Gemini AI to be read. If you answer by voice, your speech is processed by Google to turn it into text.",
    },
    {
        title: "How long we keep it",
        text: "Nothing is saved. Everything is deleted when you tap \"Delete my information\" or close the page.",
    },
    {
        title: "What this app isn't",
        text: "We're not a government agency. Results are estimates, and we don't submit anything for you.",
    },
];

export default function ConsentScreen({ goNext, goBack }) {
    const [agreed, setAgreed] = useState(false);
    return (
        <div>
            <h1>Before We Start</h1>
            <p className="helper">Here's how we handle your information. Please read it before you begin.</p>
            <ul className="consent-list">
                {consentSections.map((section) => (
                    <li key={section.title}>
                        <h2>{section.title}</h2>
                        <p>{section.text}</p>
                    </li>
                ))}
            </ul>

            <label>
                <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                />
                I understand and agree
            </label>

            <div className="actions">
                <button className="btn-primary" disabled={!agreed} onClick={goNext}>
                    Continue
                </button>
                <button className="btn-link" onClick={goBack}>Back</button>
            </div>
        </div>
    );
}
