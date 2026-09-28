import "@nudge/shared/tokens.css";
import "../desk.css";
import { createRoot } from "react-dom/client";
import { Hud } from "../Hud";

document.body.classList.add("hud");
// The window can be scaled by dragging its edge: the designed 268×242 card grows with it.
const fit = () => ((document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(Math.max(0.5, window.innerWidth / 268)));
fit();
window.addEventListener("resize", fit);
createRoot(document.getElementById("root")!).render(<Hud />);
