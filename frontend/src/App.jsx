import { useState } from "react";
import ConsentScreen from "./screens/ConsentScreen.jsx";
import IntakeUpload from "./screens/intakeUpload.jsx";
import RosterScreen from "./screens/RosterScreen.jsx";
import QuestionScreen from "./screens/QuestionScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";

export default function App() {
  const [step, setStep] = useState("consent");

  if (step === "consent") {
    return <ConsentScreen goNext={() => setStep("upload")} />;
  }

  if (step === "upload") {
    return <IntakeUpload goNext={() => setStep("roster")} />;
  }

  if (step === "roster") {
    return <RosterScreen goNext={() => setStep("questions")} />;
  }

  if (step === "questions") {
    return <QuestionScreen goNext={() => setStep("results")} />;
  }

  if (step === "results") {
    return <ResultsScreen goNext={() => setStep("forms")} goBack={() => setStep("questions")} />;
  }

  if (step === "forms") {
    return <p>Forms screen (coming soon)</p>;
  }
}