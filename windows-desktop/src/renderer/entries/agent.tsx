import "@nudge/shared/tokens.css";
import "../desk.css";
import { createRoot } from "react-dom/client";
import { Agent } from "../Agent";

document.body.classList.add("agent");
createRoot(document.getElementById("root")!).render(<Agent />);
