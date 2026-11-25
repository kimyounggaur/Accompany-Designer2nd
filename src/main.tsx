import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CrashOnPurpose, ErrorBoundary } from "./app/ErrorBoundary";
import { installGlobalErrorHandlers } from "./app/globalErrors";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/buttons.css";
import "./styles/transport.css";
import "./styles/playlist.css";
import "./styles/inspector.css";
import "./styles/focus.css";
import "./styles/eq.css";
import "./styles/mix.css";
import "./styles/delay.css";
import "./styles/reverb.css";
import "./styles/compressor.css";
import "./styles/analyzer.css";
import "./styles/layout.css";
import "./styles/feedback.css";
import "./styles/legibility.css";
import "./styles/master.css";
import "./styles/controls.css";
import "./styles/targets.css";
import "./styles/phone.css";

installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CrashOnPurpose />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
