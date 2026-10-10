// frontend/src/context/BridgeContext.jsx
import { createContext, useState } from "react";

export const BridgeContext = createContext();

const FIELD_NAMES = [
  "fullName",
  "dateOfBirth",
  "address",
  "phone",
  "householdSize",
  "monthlyIncome",
  "employer",
  "payFrequency",
  "workHours",
  "monthlyRent",
  "paysUtilities",
  "isStudent",
  "enrollmentStatus",
  "hasWorkStudy",
  "hasChildUnder6",
  "inCTEProgram",
];

function makeInitialFields() {
  const fields = {};
  for (const name of FIELD_NAMES) {
    fields[name] = { value: null, source: null };
  }
  return fields;
}

export function BridgeProvider({ children }) {
  const [fields, setFields] = useState(makeInitialFields);
  const [documents, setDocuments] = useState([]);
  const [questionQueue, setQuestionQueue] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [results, setResults] = useState([]);
  const [fixing, setFixing] = useState(null);
  const [forms, setForms] = useState([]);

  function reset() {
    setFields(makeInitialFields());
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
        fields, setFields,
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