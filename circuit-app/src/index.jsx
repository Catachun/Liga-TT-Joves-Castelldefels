import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);

// Auto-update: every minute (and when the app comes back to the foreground) compare the
// published bundle with the one running; if it changed, reload — but never while someone is typing.
(function autoUpdate() {
  let current = null;
  const sig = async () => {
    const r = await fetch("/bundle.js?v=" + Date.now(), { cache: "no-store" });
    const txt = await r.text();
    return txt.length + ":" + txt.slice(-200);
  };
  const typing = () => {
    const a = document.activeElement;
    return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  };
  const check = async () => {
    try {
      const s = await sig();
      if (current === null) { current = s; return; }
      if (s !== current && !typing()) location.reload();
    } catch (e) {}
  };
  check();
  setInterval(check, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
})();
