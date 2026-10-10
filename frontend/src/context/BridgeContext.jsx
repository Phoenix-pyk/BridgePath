// frontend/src/context/BridgeContext.jsx
import { createContext, useState } from "react";

export const BridgeContext = createContext();

function makeEmptyApplicant() {
  return {
    primary_address: null,
    mailing_address: null,
    household_members: [],
    incomes: [],
    shelter: null,
    assets: [],
    extra: {},
  };
}

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
