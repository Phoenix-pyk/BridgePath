import { useContext, useState } from "react";
import { BridgeContext } from "./context/BridgeContext.jsx";
import HomeScreen from "./screens/HomeScreen.jsx";
import ConsentScreen from "./screens/ConsentScreen.jsx";
import IntakeUpload from "./screens/intakeUpload.jsx";
import RosterScreen from "./screens/RosterScreen.jsx";
import QuestionScreen from "./screens/QuestionScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";
import FormsScreen from "./screens/FormsScreen.jsx";

export default function App() {
  const [step, setStep] = useState("home");
  const { fixing, setFixing } = useContext(BridgeContext);

  // Fixing: results sends the user to one screen to fix what's missing
  // (fixing = { type: "question" | "document", ... }); finishing it returns to
  // results, which checks eligibility again.
  function startFixing(fix) {
    setFixing(fix);
    setStep(fix.type === "question" ? "questions" : "upload");
  }

  function finishFixing() {
    setFixing(null);
    setStep("results");
  }

  if (step === "home") {
    return <HomeScreen goNext={() => setStep("consent")} />;
  }

  if (step === "consent") {
    return <ConsentScreen goNext={() => setStep("upload")} goBack={() => setStep("home")} />;
  }

  if (step === "upload") {
    return <IntakeUpload goNext={fixing ? finishFixing : () => setStep("roster")} />;
  }

  if (step === "roster") {
    return <RosterScreen goNext={() => setStep("questions")} />;
  }

  if (step === "questions") {
    return <QuestionScreen goNext={fixing ? finishFixing : () => setStep("results")} />;
  }

  if (step === "results") {
    return (
      <ResultsScreen
        goNext={() => setStep("forms")}
        goBack={() => setStep("questions")}
        onFix={startFixing}
      />
    );
  }

  if (step === "forms") {
    return <FormsScreen goBack={() => setStep("results")} onDeleted={() => setStep("home")} />;
  }
}
