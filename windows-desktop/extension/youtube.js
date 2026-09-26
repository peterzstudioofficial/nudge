// YouTube stays open for videos that match today's tasks. Everything else waits.
function check() {
  chrome.runtime.sendMessage("state", (s) => {
    if (!s || !s.active || !s.studyOnly.some((x) => location.hostname.endsWith(x))) return;
    if (!location.pathname.startsWith("/watch") && !location.pathname.startsWith("/shorts")) return;
    const title = (document.title || "").toLowerCase();
    const words = s.keywords.split(/[^a-z]+/).filter((w) => w.length > 3);
    const study = /(revision|revise|explained|lesson|gcse|a level|tutorial|how to|maths|chemistry|physics|biology|history|english|french|spanish|geography)/;
    if (study.test(title) || words.some((w) => title.includes(w))) return;
    location.replace(chrome.runtime.getURL(`block.html?site=youtube&task=${encodeURIComponent(s.task?.name || "")}&pct=${s.pct}`));
  });
}
check();
let last = location.href;
setInterval(() => {
  if (location.href !== last) {
    last = location.href;
    setTimeout(check, 1500);
  }
}, 1000);
