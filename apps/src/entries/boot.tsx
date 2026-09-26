import "@nudge/shared/tokens.css";
import "../lib/app.css";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { loadPairing, type AppKey } from "../lib/hub";
import { Pair } from "../lib/Pair";
import { Toaster } from "../lib/ui";

/** Shared start-up for every app: theme, pairing gate, toasts, offline shell. */
export function boot(opts: { app: AppKey; theme: "dark" | "light" | "paper"; title: string; render: (unpair: () => void) => ReactNode }) {
  document.body.classList.add(opts.theme);
  function Root() {
    const [paired, setPaired] = useState(() => !!loadPairing(opts.app));
    return (
      <>
        <Toaster dark={opts.theme === "dark"} />
        {paired ? opts.render(() => setPaired(false)) : <Pair app={opts.app} dark={opts.theme === "dark"} title={opts.title} onDone={() => setPaired(true)} />}
      </>
    );
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
