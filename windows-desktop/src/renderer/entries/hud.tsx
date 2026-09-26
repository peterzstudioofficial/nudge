import "@nudge/shared/tokens.css";
import "../desk.css";
import { createRoot } from "react-dom/client";
import { Hud } from "../Hud";

document.body.classList.add("hud");
createRoot(document.getElementById("root")!).render(<Hud />);
