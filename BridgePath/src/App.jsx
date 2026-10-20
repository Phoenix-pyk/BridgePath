import { useContext, useState } from "react";
import { BridgeContext } from "./context/BridgeContext.jsx";
import HomeScreen from "./screens/HomeScreen/HomeScreen.jsx";
import ConsentScreen from "./screens/ConsentScreen/ConsentScreen.jsx";
import IntakeUpload from "./screens/intakeUpload/intakeUpload.jsx";
import RosterScreen from "./screens/RosterScreen/RosterScreen.jsx";
import QuestionScreen from "./screens/QuestionScreen/QuestionScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen/ResultsScreen.jsx";
import FormsScreen from "./screens/FormsScreen/FormsScreen.jsx";
import logo from "./assets/logo.png";

// Steps shown in the progress bar (home has its own big logo instead)
const PROGRESS_STEPS = ["consent", "upload", "roster", "questions", "results", "forms"];

function Header({ step }) {
  const done = ((PROGRESS_STEPS.indexOf(step) + 1) / PROGRESS_STEPS.length) * 100;
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <img src={logo} alt="BridgePath" />
      </div>
      <div className="progress" role="progressbar" aria-label="Progress" aria-valuenow={Math.round(done)} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${done}%` }} />
      </div>
    </header>
  );
}

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

  // Which screen to show
  function renderScreen() {
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

  return (
    <>
      {step !== "home" && <Header step={step} />}
      <main className="container">{renderScreen()}</main>
    </>
  );
}
