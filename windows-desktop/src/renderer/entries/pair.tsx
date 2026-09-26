import "@nudge/shared/tokens.css";
import "../desk.css";
import { createRoot } from "react-dom/client";
import { Pair } from "../Pair";

document.body.classList.add("pair");
createRoot(document.getElementById("root")!).render(<Pair />);
