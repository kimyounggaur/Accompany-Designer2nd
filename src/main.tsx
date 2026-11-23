import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CrashOnPurpose, ErrorBoundary } from "./app/ErrorBoundary";
import { installGlobalErrorHandlers } from "./app/globalErrors";
import "./styles.css";
import "./styles/layout.css";
import "./styles/feedback.css";
import "./styles/legibility.css";
import "./styles/master.css";

installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CrashOnPurpose />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
