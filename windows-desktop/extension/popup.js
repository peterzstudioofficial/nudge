// The toolbar popup: what's blocked right now, in the same shape as the design.
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const name = (site) => site.replace(/^www\./, "").replace(/\.(com|net|org|tv|co\.uk)$/, "");

function row(icon, label, st, on) {
  const r = el("div", "row");
  const i = el("span", "ms", icon);
  i.style.color = on === "block" ? "#ff4d17" : on === "study" ? "#8e8e97" : "#5c5c66";
  const n = el("span", "name", label);
  n.style.color = on === "block" ? "#f4f3ef" : on === "study" ? "#c9c8c2" : "#8e8e97";
  const s = el("span", "st", st);
  s.style.color = on === "block" ? "#ff4d17" : on === "study" ? "#8e8e97" : "#43434c";
  r.append(i, n, s);
  return r;
}

chrome.runtime.sendMessage("state", (s) => {
  const state = document.getElementById("state");
  const rows = document.getElementById("rows");
  if (!s || !s.connected) {
    state.textContent = "APP NOT RUNNING";
    state.className = "idle";
    rows.append(el("div", "empty", "Open Nudge on this computer to use the blocker."));
    return;
  }
  state.textContent = s.active ? "SESSION ACTIVE" : "NO SESSION";
  state.className = s.active ? "" : "idle";
  document.getElementById("head").textContent = s.active ? "BLOCKED NOW" : "BLOCKED DURING A SESSION";
  const uniq = (list) => [...new Map(list.map((x) => [name(typeof x === "string" ? x : x.name), x])).values()];
  const SUBJECT = { art: "ART", drama: "DRAMA", music: "MUSIC", biz: "BUSINESS", eng: "ENGLISH", cs: "COMPUTING" };
  // Open because of the task on the wall (e.g. Pinterest while it's an art task).
  for (const a of uniq(s.allowed || [])) rows.append(row("palette", name(a.name), `OPEN FOR ${SUBJECT[a.why] || a.why.toUpperCase()}`, "study"));
  const blocked = uniq(s.blockList);
  for (const site of blocked.slice(0, 6)) rows.append(row("block", name(site), s.active ? "BLOCKED" : "WAITS", s.active ? "block" : "open"));
  if (blocked.length > 6) rows.append(row("more_horiz", `${blocked.length - 6} more`, s.active ? "BLOCKED" : "WAITS", "open"));
  for (const site of s.studyOnly) rows.append(row("smart_display", name(site), "STUDY ONLY", "study"));
  for (const site of s.open || []) rows.append(row("school", site.includes("sharepoint") ? "school portal" : name(site), "OPEN", "open"));
});
