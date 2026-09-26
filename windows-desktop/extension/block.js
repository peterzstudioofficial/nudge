const q = new URLSearchParams(location.search);
document.getElementById("site").textContent = (q.get("site") || "") + (q.get("site") && !q.get("site").includes(".") ? ".com" : "");
if (q.get("task")) document.getElementById("task").textContent = q.get("task");
if (/^#[0-9a-f]{6}$/i.test(q.get("tint") || "")) document.getElementById("tint").style.background = q.get("tint");
document.getElementById("pct").style.width = Math.min(100, Number(q.get("pct")) || 0) + "%";
// When the session ends, go back to where you were heading.
setInterval(() => {
  chrome.runtime.sendMessage("state", (s) => {
    const site = q.get("site") || "";
    if (s && !s.active) location.replace(site.includes(".") ? "https://" + site : "https://www.youtube.com");
  });
}, 5000);
