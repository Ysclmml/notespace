import React from "react";
import ReactDOM from "react-dom/client";

import { AppBootstrap } from "./app/bootstrap/AppBootstrap";
import "./styles/tokens.css";
import "./styles/base.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element is missing");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppBootstrap />
  </React.StrictMode>,
);
