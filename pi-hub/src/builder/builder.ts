import type { BuildRequest, Job, ToolTarget } from "@nudge/shared";
import type { Hub } from "../hub";
import type { OrClient } from "./openrouter";
import { addSpend, spend } from "../agent/spend";

/**
 * The tool builder. After a yes, it turns a request ("a flashcard app for chemistry on my
 * phone") into a small offline web app that shows up in the phone's Tools tab.
 *
 * - now:   OpenRouter Responses + the sandboxed `openrouter:bash` container (no internet): the
 *          model writes the app into out/, tests it, and the files are read back.
 * - later: OpenRouter Batch at half price, usually done within minutes; if the model or account
 *          can't batch, it runs in the sandbox overnight instead.
 * - computer: handled by the hub as a hand-off to Claude Code (see Hub.startJob).
 *
 * Every job was confirmed with its cost first (the "build" ask). Attachments are uploaded with the
 * Files API for that one job and deleted straight after.
 */
const MAX_PRICE = { prompt: "0.5", completion: "1.5" };
const MAX_BYTES = 5 * 1024 * 1024;

export const BUILD_SYSTEM = `You build small, polished web apps ("tools") for a 15-year-old student in the UK.
- One self-contained index.html: inline CSS, JavaScript and SVG. No frameworks from the internet, no CDNs, no external fonts, no network requests at all. It must work offline.
- Mobile first: portrait phone, big touch targets, readable at arm's length; also fine on a laptop. Dark theme with one warm accent colour (#ff4d17) unless asked otherwise.
- Save anything the user enters in localStorage under a key unique to this tool.
- Include <meta name="viewport" content="width=device-width, initial-scale=1"> and a short <title>.
- Keep it focused: do the one job well. Clear empty states. No ads, trackers, analytics or sign-ups.
- Never include personal details beyond what the request itself says.`;

const SANDBOX_RULES = `You have a sandboxed Linux shell with no internet. Work like this:
1. Write the app to out/index.html (extra files only if really needed, all under out/).
2. Test it: check the HTML is well-formed and every <script> has no syntax errors (e.g. extract each script to a .js file and run \`node --check\` on it, if node is available). Fix anything that fails.
3. Reply with two short lines: what it does, and how to use it.
Attached files (if any) are available in the sandbox; find them with \`ls -R\`.`;

const ICONS: [RegExp, string][] = [
  [/flash ?card|quiz|revis|test me/i, "quiz"],
  [/timer|pomodoro|countdown|clock/i, "timer"],
  [/script|lines?\b|rehears|theat|drama|scene|musical/i, "theater_comedy"],
  [/music|song|lyric|chord|metronome|tune/i, "music_note"],
  [/film|video|shot|storyboard|camera/i, "movie"],
  [/calc|maths|math|equation|formula/i, "calculate"],
  [/plan|schedule|calendar|week/i, "calendar_month"],
  [/note|journal|diary|write/i, "edit_note"],
  [/workout|gym|run|fitness|exercise/i, "fitness_center"],
  [/money|budget|spend/i, "savings"],
];
export const iconFor = (s: string) => ICONS.find(([re]) => re.test(s))?.[1] ?? "apps";

const targetText = (t: ToolTarget) => (t === "phone" ? "a phone" : t === "school" ? "school work on a laptop" : "phone and laptop");

/** Rough cost before asking, in USD (shown on the confirm). */
export function estimateBuild(r: Pick<BuildRequest, "when" | "where" | "brief">): number {
  if (r.where === "computer") return 0; // Claude Code on the PC uses your Claude plan, not OpenRouter
  const inK = 6 + r.brief.length / 4000;
  if (r.when === "later") return +((inK * 0.035 + 14 * 0.29) / 1000 / 2).toFixed(4); // batch: half price, one pass
  // sandbox: several turns re-reading the growing context + ~2 minutes of container time
  return +((inK * 8 * 0.035 + 24 * 0.29) / 1000 + 0.012).toFixed(4);
}

/** The app from a model's reply, if it wrote it inline. */
export function htmlFromText(text: string): string | null {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(text);
  const html = (fenced ? fenced[1] : text).trim();
  return /^<!doctype html|^<html[\s>]/i.test(html) && /<\/html>\s*$/i.test(html) ? html : null;
}

const mimeFor = (p: string) =>
  p.endsWith(".html") ? "text/html" : p.endsWith(".js") ? "text/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".svg") ? "image/svg+xml"
    : p.endsWith(".png") ? "image/png" : p.endsWith(".json") || p.endsWith(".webmanifest") ? "application/json" : "application/octet-stream";

export interface BuilderService {
  poll(): Promise<void>;
  cancel(id: string): void;
}

export function builderService(o: {
  hub: Hub;
  or: OrClient;
  log: (m: string) => void;
  say: (icon: string, line: string, sub?: string, ms?: number) => void;
  now?: () => Date;
}): BuilderService {
  const { hub, or } = o;
  const running = new Map<string, AbortController>();
  const now = o.now ?? (() => new Date());

  const request = (j: Job) => j.request;
  const brief = (j: Job) => {
    const r = request(j);
    const current = r.toolId ? hub.toolFile(r.toolId, "index.html") : null;
    return [
      `Build "${r.title}" for ${targetText(r.target)}.`,
      "",
      r.brief,
      ...(current ? ["", "Improve the current version below; keep what works and keep its saved-data key.", "```html", new TextDecoder().decode(current.data).slice(0, 60_000), "```"] : []),
    ].join("\n");
  };

  async function uploadAttachments(j: Job): Promise<string[]> {
    const ids: string[] = [];
    for (const a of request(j).attachments) {
      const blob = hub.db.blobGet(`attach:${a.id}`);
      if (blob) ids.push(await or.uploadFile(a.name, a.mime, blob.data));
    }
    return ids;
  }
  const cleanup = async (fileIds: string[], j: Job) => {
    for (const id of fileIds) await or.deleteFile(id);
    for (const a of request(j).attachments) hub.db.blobDel(`attach:${a.id}`);
  };

  function finish(j: Job, files: Record<string, { mime: string; data: Uint8Array }>, cost: number, summary: string) {
    const r = request(j);
    const tool = hub.putTool(
      { id: r.toolId ?? undefined, title: r.title, description: (summary || r.brief).replace(/\s+/g, " ").slice(0, 300), icon: iconFor(`${r.title} ${r.brief}`), target: r.target, jobId: j.id },
      files,
    );
    hub.updateJob(j.id, { status: "done", toolId: tool.id, costUsd: +(j.costUsd + cost).toFixed(4), note: "ready in your Tools tab", error: null });
    if (cost) addSpend(hub, cost);
    hub.feed("agent", `Built "${r.title}" — it's in your Tools tab`);
    note(j, `Built "${r.title}". Open it from the Tools tab on your phone${r.target === "phone" ? " and tap install to add it as an app" : ""}.`);
    o.say("apps", `${r.title.toLowerCase()} is ready`, "IN YOUR PHONE'S TOOLS TAB", 5000);
  }

  const overBudget = (j: Job) => spend(hub).usd + j.estUsd > hub.settings().aiBudgetUsd;

  function fail(j: Job, msg: string) {
    hub.updateJob(j.id, { status: "failed", error: msg.slice(0, 200), note: "didn't finish" });
    note(j, `Couldn't build "${request(j).title}": ${msg}`);
    o.log(`builder: ${request(j).title}: ${msg}`);
  }

  function note(j: Job, text: string) {
    const t = j.threadId ? hub.threads.get(j.threadId) : null;
    if (!t) return;
    t.log.push({ icon: "apps", text });
    hub.threads.put({ ...t, updatedAt: hub.now() });
    hub.bus.changed("agent");
  }

  /** Build now, in OpenRouter's sandbox. */
  async function runNow(id: string) {
    const j = hub.jobs.get(id);
    if (!j || running.has(id) || j.status === "cancelled" || j.status === "done") return;
    if (overBudget(j)) return fail(j, "this month's AI budget is used up (raise it in setup)");
    const ac = new AbortController();
    running.set(id, ac);
    let fileIds: string[] = [];
    try {
      hub.updateJob(id, { status: "running", note: "building and testing in a sandbox" });
      fileIds = await uploadAttachments(j);
      const s = hub.settings();
      const r = await or.responses(
        {
          model: s.buildModel,
          instructions: `${BUILD_SYSTEM}\n\n${SANDBOX_RULES}`,
          input: [{ role: "user", content: [{ type: "input_text", text: brief(j) }, ...fileIds.map((f) => ({ type: "input_file", file_id: f }))] }],
          tools: [{ type: "openrouter:bash", parameters: { environment: { type: "container_auto", network_policy: { type: "disabled" }, ...(fileIds.length ? { file_ids: fileIds } : {}) } } }],
          stop_server_tools_when: [{ type: "step_count_is", step_count: 25 }, { type: "max_cost", max_cost_in_dollars: 0.25 }],
          max_output_tokens: 32_000,
          session_id: `build-${id}`,
          store: false,
          provider: { zdr: true, data_collection: "deny", max_price: MAX_PRICE },
          usage: { include: true },
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      // The app's files, from the sandbox (anything under out/).
      const files: Record<string, { mime: string; data: Uint8Array }> = {};
      let bytes = 0;
      for (const cid of r.containerIds) {
        const list = await or.containerFiles(cid).catch(() => []);
        for (const f of list) {
          const m = /(?:^|\/)out\/(.+)$/.exec(f.path);
          if (!m || m[1].includes("..") || Object.keys(files).length >= 30 || bytes + f.bytes > MAX_BYTES) continue;
          const data = await or.containerFile(cid, f.id);
          bytes += data.length;
          files[m[1]] = { mime: mimeFor(m[1]), data };
        }
      }
      if (!files["index.html"]) {
        const html = htmlFromText(r.text);
        if (html) files["index.html"] = { mime: "text/html", data: new TextEncoder().encode(html) };
      }
      if (!files["index.html"]) throw new Error("the sandbox didn't produce out/index.html");
      finish(hub.jobs.get(id)!, files, r.cost, r.text.replace(/```[\s\S]*?```/g, "").trim().slice(0, 300));
    } catch (e) {
      if (!ac.signal.aborted) fail(hub.jobs.get(id) ?? j, (e as Error).message);
    } finally {
      running.delete(id);
      await cleanup(fileIds, j).catch(() => {});
    }
  }

  /** Build later at half price (Batch). Falls back to an overnight sandbox build. */
  async function queueLater(id: string) {
    const j = hub.jobs.get(id);
    if (!j) return;
    if (overBudget(j)) return fail(j, "this month's AI budget is used up (raise it in setup)");
    let fileIds: string[] = [];
    try {
      fileIds = await uploadAttachments(j);
      const s = hub.settings();
      const b = await or.createBatch({
        model: s.buildModel,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
        requests: [
          {
            custom_id: id,
            body: {
              messages: [
                { role: "system", content: `${BUILD_SYSTEM}\n\nReply with the complete index.html in one \`\`\`html code block, then one line saying what it does.` },
                { role: "user", content: [{ type: "text", text: brief(j) }, ...fileIds.map((f) => ({ type: "file", file: { file_id: f } }))] },
              ],
              max_tokens: 24_000,
              plugins: [{ id: "file-parser" }],
            },
          },
        ],
      });
      hub.db.kvSet(`jobfiles:${id}`, fileIds);
      hub.updateJob(id, { status: "waiting", batchId: b.id, note: "queued at half price — usually ready within the hour" });
    } catch (e) {
      await cleanup(fileIds, j).catch(() => {});
      o.log(`builder: batch not available (${(e as Error).message}); building tonight instead`);
      hub.updateJob(id, { status: "queued", note: "will build tonight" });
    }
  }

  async function poll() {
    for (const j of hub.jobs.all()) {
      if (j.request.where !== "pi") continue;
      if (j.status === "waiting" && j.batchId) {
        const b = await or.getBatch(j.batchId).catch((e) => ({ status: "error", error: (e as Error).message, text: null, cost: 0 }));
        if (b.status === "completed") {
          const html = b.text ? htmlFromText(b.text) : null;
          await cleanup(hub.db.kvGet<string[]>(`jobfiles:${j.id}`, []), j).catch(() => {});
          if (html) finish(j, { "index.html": { mime: "text/html", data: new TextEncoder().encode(html) } }, b.cost, (b.text ?? "").replace(/```[\s\S]*?```/g, "").trim());
          else fail(j, "the batch answer didn't contain an app");
        } else if (b.status === "failed" || b.status === "expired") {
          await cleanup(hub.db.kvGet<string[]>(`jobfiles:${j.id}`, []), j).catch(() => {});
          hub.updateJob(j.id, { status: "queued", batchId: null, note: "batch didn't run; building tonight" });
        }
      } else if (j.status === "queued" && j.request.when === "later") {
        // Overnight (1–6am), or once it has waited 12 hours.
        const h = now().getHours();
        if ((h >= 1 && h < 6) || hub.now() - j.createdAt > 12 * 3600_000) void runNow(j.id);
      }
    }
  }

  hub.onJobQueued = (j) => void (j.request.when === "now" ? runNow(j.id) : queueLater(j.id));

  // After a restart: a build that was running starts again; waiting batches keep being checked.
  for (const j of hub.jobs.all()) {
    if (j.request.where === "pi" && j.request.when === "now" && (j.status === "running" || j.status === "queued")) void runNow(j.id);
  }
  setInterval(() => void poll().catch((e) => o.log(`builder: ${(e as Error).message}`)), 3 * 60_000).unref();

  return {
    poll,
    cancel(id) {
      running.get(id)?.abort();
      const j = hub.jobs.get(id);
      if (j && !["done", "failed"].includes(j.status)) hub.updateJob(id, { status: "cancelled", note: "cancelled" });
    },
  };
}
