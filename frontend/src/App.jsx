import { useState } from "react";
import ConsentScreen from "./screens/ConsentScreen.jsx";

export default function App() {
  const [step, setStep] = useState("consent");

  if (step === "consent") {
    return <ConsentScreen goNext={() => setStep("upload")} />;
  }

  if (step === "upload") {
    return <p>Upload screen (coming soon)</p>;
  }

  if (step === "questions") {
    return <p>Question screen (coming soon)</p>;
  }

  if (step === "results") {
    return <p>Results screen (coming soon)</p>;
  }

  if (step === "forms") {
    return <p>Forms screen (coming soon)</p>;
  }
}