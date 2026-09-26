// Nudge blocker — asks the Nudge app on this computer whether a focus session is running and,
// if so, sends the listed sites to a "not now :)" page. Nothing leaves this computer.
let state = { active: false, blockList: [], studyOnly: [], open: [], task: null, pct: 0, keywords: "" };
let connected = false;
let conf = null;

async function config() {
  if (conf) return conf;
  try {
    conf = await (await fetch(chrome.runtime.getURL("key.json"))).json();
  } catch {
    conf = null;
  }
  return conf;
}

function hostMatches(url, site) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h === site || h.endsWith("." + site);
  } catch {
    return false;
  }
}

async function poll() {
  const c = await config();
  if (!c) return;
  try {
    const r = await fetch(`http://127.0.0.1:${c.port}/state`, { headers: { "x-nudge-key": c.key }, cache: "no-store" });
    if (!r.ok) return;
    state = await r.json();
    connected = true;
  } catch {
    state = { ...state, active: false }; // app not running → don't block
    connected = false;
  }
  await apply();
}

async function apply() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id) });
  if (!state.active) return;
  const page = (site) =>
    chrome.runtime.getURL(`block.html?site=${encodeURIComponent(site)}&task=${encodeURIComponent(state.task?.name || "")}&pct=${state.pct}&tint=${encodeURIComponent(state.task?.tint || "")}`);
  const rules = state.blockList.slice(0, 100).map((site, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "redirect", redirect: { url: page(site) } },
    condition: { requestDomains: [site], resourceTypes: ["main_frame"] },
  }));
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
  // Tabs already open on a blocked site go too.
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    const site = state.blockList.find((s) => t.url && hostMatches(t.url, s));
    if (site) chrome.tabs.update(t.id, { url: page(site) });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === "state") reply({ ...state, connected });
});
chrome.alarms.create("poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(poll);
chrome.runtime.onStartup.addListener(poll);
chrome.runtime.onInstalled.addListener(poll);
setInterval(poll, 5000);
poll();
