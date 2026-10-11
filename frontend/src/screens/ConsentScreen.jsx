import { useState } from "react";

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
            {consentSections.map((section) => (
                <section key={section.title}>
                    <h2>{section.title}</h2>
                    <p>{section.text}</p>
                </section>
            ))}

            <label>
                <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                />
                I understand and agree
            </label>

            <button onClick={goBack}>Back</button>
            <button disabled={!agreed} onClick={goNext}>
                Continue
            </button>
        </div>
    );
}
