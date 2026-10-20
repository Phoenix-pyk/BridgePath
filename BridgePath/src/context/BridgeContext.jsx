// frontend/src/context/BridgeContext.jsx
import { createContext, useState } from "react";
import { makeEmptyApplicant } from "../utils/applicantModel.js";

export const BridgeContext = createContext();

// `applicant` shape: see utils/applicantModel.js

export function BridgeProvider({ children }) {
  const [applicant, setApplicant] = useState(makeEmptyApplicant);
  const [documents, setDocuments] = useState([]);
  const [questionQueue, setQuestionQueue] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [results, setResults] = useState([]);
  const [fixing, setFixing] = useState(null);
  const [forms, setForms] = useState([]);

  function reset() {
    setApplicant(makeEmptyApplicant());
    setDocuments([]);
    setQuestionQueue([]);
    setCurrentQuestion(0);
    setResults([]);
    setFixing(null);
    setForms([]);
  }

  return (
    <BridgeContext.Provider
      value={{
        applicant, setApplicant,
        documents, setDocuments,
        questionQueue, setQuestionQueue,
        currentQuestion, setCurrentQuestion,
        results, setResults,
        fixing, setFixing,
        forms, setForms,
        reset,
      }}
    >
      {children}
    </BridgeContext.Provider>
  );
}
