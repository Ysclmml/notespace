import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/tokens.css";
import "./styles/base.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Application root element is missing");
}

async function renderApplication() {
  const Application =
    __APP_SURFACE__ === "mobile"
      ? (await import("./mobile/MobileAppBootstrap")).MobileAppBootstrap
      : (await import("./app/bootstrap/AppBootstrap")).AppBootstrap;

  ReactDOM.createRoot(rootElement as HTMLElement).render(
    <React.StrictMode>
      <Application />
    </React.StrictMode>,
  );
}

void renderApplication();
