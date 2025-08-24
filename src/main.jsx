import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

function showRuntimeErrorOnPage(evt){
  const root = document.getElementById("root");
  if (!root) return;
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.padding = "16px";
  pre.style.fontFamily = "system-ui, monospace";
  pre.style.background = "#fff3f3";
  pre.style.border = "1px solid #f5c2c7";
  pre.textContent = "Runtime error: " + (evt.reason?.message || evt.message || String(evt.reason || evt.error || evt));
  root.prepend(pre);
}
window.addEventListener("error", showRuntimeErrorOnPage);
window.addEventListener("unhandledrejection", showRuntimeErrorOnPage);

const root = createRoot(document.getElementById("root"));
root.render(<App />);
