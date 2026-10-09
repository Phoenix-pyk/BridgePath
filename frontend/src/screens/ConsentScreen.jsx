import { useState } from "react";
import logo_placeholder from "../assets/logo_placeholder.png" 

const consentPoints = [
    "What we collect:       the documents you upload and your answers.",
    "Why:                   to estimate your eligibility and fill out your application forms.",
    "Who else sees it:      your documents are sent to Google's Gemini AI to be read.",
    "How long we keep it:   everything is deleted when you download your forms or close the page.",
    "What this app isn't:   not a government agency. Results are estimates, and the app doesn't submit anything for you.",
    "Voice answers:         if you answer by voice, your speech is processed by Google to convert it to text.",
];

export default function ConsentScreen ({goNext}){
    const [agreed, setAgreed] = useState(false);
    return (
        <div>
            <img src={logo_placeholder} alt="BridgePath Logo" width={120}/>
            <p>
                lorem ipsum dolor sit amet consectetur adipiscing elit aute temporibus 
                consectetur quis quidem laboris ex provident et atque quis voluptatum 
                soluta ullamco illum eiusmod distinctio velit consequatur facere illum 
                dolore labore libero nostrud sunt similique et est nostrud veniam eos 
                amet quod ut do et cum aut vel irure eum
            </p>

            <h1>Before We Start</h1>
            <ul>
                {consentPoints.map((point) => (
                   <li key={point}>{point}</li>     
                ))}
            </ul>

            <label>
                <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}>
                </input>
                I Understand and agree
            </label>

            <button disabled={!agreed} onClick={goNext}>
        Continue
      </button>
        </div>
    )
}