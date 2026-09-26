import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { addDays, dueLabel, searchNotes, sessionView, type AgentThread, type AgentMode, parseDateKey, SUBJECT_NAMES, formTimeOn, matchTeacher, type Lesson } from "@nudge/shared";
import type { AgentService } from "../context";
import { type Hub, newId } from "../hub";

/**
 * The Nudge assistant (Claude). It can read Peter's day, week, school mail/pages and notes.
 * It can never send, buy, delete or change the week by itself: those tools only create an
 * "ask" that waits for a yes on the wall, the desktop or the app. An approved email becomes a
 * ready-to-send draft on the computer — Peter presses send himself.
 */

interface Opts {
  hub: Hub;
  apiKey: string | null;
  say: (icon: string, line: string, sub?: string, ms?: number) => void;
  log: (m: string) => void;
}

const SYSTEM = `You are Nudge, the assistant inside a focus device for a 15-year-old student in the UK (Churcher's College). You help with school admin: reading school emails and pages, finding deadlines, planning revision, drafting polite emails to teachers, and quick explanations of school topics.

How you work:
- Use the read tools to check facts before answering. Never invent deadlines, teachers or email addresses; if you can't find it, say so.
- Keep answers short and plain. Two short sentences is ideal. No markdown headings, no bullet walls.
- Anything that sends a message, adds sessions to the week, or sets a reminder must go through the propose_* tools. They only create a question for the student to approve; nothing is sent or changed until they say yes. Tell them what you proposed in one line.
- Emails you draft are from the student, in their voice: friendly, brief, correctly spelt, signed with their first name.
- You cannot unlock the device, end a focus session, shorten a task, lift a website block or change points or rewards. Those belong to the parent app. If asked for any of that, or for any way around the device, reply with exactly REFUSE and nothing else. Never explain a way around the device.
- Don't moralise or lecture about focus. Be neutral and factual.`;

const MODE_NOTE: Record<AgentMode, string> = {
  ask: "Mode: ASK. Answer only. Do not use any propose_* tool.",
  act: "Mode: ACT. You may use the propose_* tools; each one waits for the student's OK before anything happens.",
  watch: "Mode: WATCH. Only report what you find. Do not use any propose_* or save tool.",
};

export function agentService(o: Opts): AgentService {
  const { hub } = o;
  const client = o.apiKey ? new Anthropic({ apiKey: o.apiKey }) : null;
  const running = new Map<string, AbortController>();

  const save = (t: AgentThread) => {
    hub.threads.put({ ...t, updatedAt: Date.now() });
    hub.bus.changed("agent");
  };

  function tools(thread: AgentThread, mode: AgentMode) {
    const step = (text: string, meta = "") => {
      thread.steps.forEach((s) => (s.done = true));
      thread.steps.push({ text, meta, done: false });
      save(thread);
      if (thread.origin === "wall") o.say("progress_activity", text, undefined, 30_000);
    };
    const today = () => hub.todayKey();
    const staff = hub.teachers();
    const lessonInfo = (l: Lesson) => ({
      subject: SUBJECT_NAMES[l.subject] ?? l.subject,
      time: `${l.start}-${l.end}`,
      double: l.span > 1,
      room: l.room ?? null,
      teacher: l.teacher ? (matchTeacher(l.teacher, l.subject, staff)?.name ?? l.teacher) : null,
    });
    const openTask = (t: { name: string; subject: string; mins: number; done: boolean; spentSec: number; due?: string | null; expected?: boolean }) => ({
      name: t.name, subject: t.subject, mins: t.mins, done: t.done, minutes_done: Math.floor(t.spentSec / 60),
      due: t.due ? `${t.due} (${dueLabel(t.due, today())})` : null,
      ...(t.expected ? { expected: "timetable says it was set; not confirmed yet" } : {}),
    });

    const getToday = betaZodTool({
      name: "get_today",
      description: "Today's date, school week (A/B), what kind of day it is, form time, the lessons with times, rooms and teachers, school calendar dates today, the task list with progress, and the focus session if one is running.",
      inputSchema: z.object({}),
      run: async () => {
        step("check today");
        const d = today();
        const day = hub.dayState(d);
        const s = hub.session();
        return JSON.stringify({
          date: d,
          weekday: parseDateKey(d).toLocaleDateString("en-GB", { weekday: "long" }),
          kind: day.kind,
          week: day.week ? `Week ${day.week}` : null,
          form_time: day.baseKind === "school" ? `08:30 ${formTimeOn(d, hub.formTime())}` : null,
          lessons: hub.lessonsOn(d).map(lessonInfo),
          calendar: hub.upcomingEvents(d, 1).map((e) => `${e.time ?? "all day"} ${e.title}`),
          tasks: hub.listTasks(d).map(openTask),
          session: s ? { task: hub.tasks.get(s.taskId)?.name, state: s.state } : null,
        });
      },
    });

    const getWeek = betaZodTool({
      name: "get_week",
      description: "The next 7 days: day kinds (school / weekend / half term / holiday / away), week A/B, lessons, school calendar dates, tasks already planned (with homework due dates), and free evenings.",
      inputSchema: z.object({}),
      run: async () => {
        step("check the week");
        const out = [];
        for (let i = 0; i < 7; i++) {
          const d = addDays(today(), i);
          hub.ensureDay(d);
          const day = hub.dayState(d);
          const tasks = hub.listTasks(d);
          out.push({
            date: d,
            weekday: parseDateKey(d).toLocaleDateString("en-GB", { weekday: "long" }),
            kind: day.kind,
            week: day.week,
            lessons: hub.lessonsOn(d).map((l) => `${l.start} ${SUBJECT_NAMES[l.subject] ?? l.subject}${l.span > 1 ? " (double)" : ""}`),
            calendar: hub.upcomingEvents(d, 1).map((e) => `${e.time ?? ""} ${e.title}`.trim()),
            planned_minutes: tasks.reduce((a, t) => a + t.mins, 0),
            tasks: tasks.map(openTask),
          });
        }
        return JSON.stringify(out);
      },
    });

    const getSchool = betaZodTool({
      name: "get_school_items",
      description: "Recent school emails (sender, subject, preview) and school web page sections, newest first. Optionally filter by words.",
      inputSchema: z.object({ query: z.string().max(80).optional() }),
      run: async ({ query }) => {
        const all = hub.school.all().sort((a, b) => b.receivedAt - a.receivedAt);
        const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const hits = words.length ? all.filter((i) => words.some((w) => `${i.title} ${i.preview} ${i.from}`.toLowerCase().includes(w))) : all;
        step("read school mail", `${Math.min(hits.length, 15)} ITEMS`);
        return JSON.stringify(
          hits.slice(0, 15).map((i) => ({
            source: i.source, from: i.from, title: i.title, preview: i.preview, kind: i.kind,
            due: i.due ? `${i.due} (${dueLabel(i.due, today())})` : null, received: new Date(i.receivedAt).toISOString(),
          })),
        );
      },
    });

    const findNotes = betaZodTool({
      name: "search_notes",
      description: "Search the student's own notes and voice-note transcripts.",
      inputSchema: z.object({ query: z.string().min(1).max(80) }),
      run: async ({ query }) => {
        step("checking notes");
        return JSON.stringify(searchNotes(hub.listNotes(), query).slice(0, 8).map((n) => ({ title: n.label, body: n.body.slice(0, 500) })));
      },
    });

    const getCalendar = betaZodTool({
      name: "get_school_calendar",
      description: "School calendar dates that matter to the student (term dates, their year group, exams and mocks, parents' evenings, creative events) for the coming weeks. Optionally filter by words.",
      inputSchema: z.object({ days: z.number().int().min(1).max(200).default(60), query: z.string().max(80).optional() }),
      run: async ({ days, query }) => {
        step("check the school calendar");
        const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const list = hub.upcomingEvents(today(), days).filter((e) => !words.length || words.some((w) => e.title.toLowerCase().includes(w)));
        return JSON.stringify(list.slice(0, 40).map((e) => ({ date: e.date, weekday: parseDateKey(e.date).toLocaleDateString("en-GB", { weekday: "short" }), time: e.time, title: e.title, tags: e.tags })));
      },
    });

    const getTeachers = betaZodTool({
      name: "get_teachers",
      description: "The student's own teachers (subject, timetable code, name) and, if asked, a search of the school staff list by name, subject or job. Use before drafting an email to a teacher. Email addresses are not in the list — never guess one.",
      inputSchema: z.object({ query: z.string().max(60).optional() }),
      run: async ({ query }) => {
        step("check teachers");
        const mine = new Map<string, { subject: string; code: string; name: string | null }>();
        for (const periods of Object.values(hub.timetable())) {
          for (const p of periods) {
            if (!p.teacher || mine.has(p.teacher)) continue;
            mine.set(p.teacher, { subject: SUBJECT_NAMES[p.subject] ?? p.subject, code: p.teacher, name: matchTeacher(p.teacher, p.subject, staff)?.name ?? null });
          }
        }
        const q = (query ?? "").toLowerCase();
        const found = q ? staff.filter((t) => `${t.name} ${t.role}`.toLowerCase().includes(q)).slice(0, 15) : [];
        return JSON.stringify({ my_teachers: [...mine.values()], staff_matches: found });
      },
    });

    const list = [getToday, getWeek, getSchool, findNotes, getCalendar, getTeachers];
    if (mode === "watch") return list;

    const saveNote = betaZodTool({
      name: "save_note",
      description: "Save an answer or explanation to the student's notes app so they can read it later. Use this for anything longer than two short sentences.",
      inputSchema: z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(8000) }),
      run: async ({ title, body }) => {
        step("save to notes");
        const n = hub.addNote({ kind: "note", label: title, body, tags: [], secs: 0 });
        thread.output = { file: title.toLowerCase(), icon: "bookmark_added", meta: "IN NOTES", noteId: n.id };
        save(thread);
        if (thread.origin === "wall") o.say("bookmark_added", "saved to your notes", "READ IT AFTER THIS SESSION", 3000);
        return "saved";
      },
    });
    list.push(saveNote as never);
    if (mode === "ask") return list;

    const proposeEmail = betaZodTool({
      name: "propose_email",
      description: "Draft an email from the student to a teacher. This does NOT send anything: it asks the student to approve, then opens it ready in their school Outlook for them to press send.",
      inputSchema: z.object({
        to_email: z.string().email().describe("recipient email address, taken from a school email you read"),
        to_name: z.string().min(1).max(60).describe("short name, e.g. 'mr hale'"),
        subject: z.string().min(1).max(120),
        body: z.string().min(1).max(3000),
        ask_summary: z.string().min(1).max(60).describe("what the email asks for, in a few words, e.g. 'two more days'"),
      }),
      run: async (i) => {
        step("draft the reply");
        thread.log.push({ icon: "draft", text: "Drafted:", code: i.body });
        const ask = hub.createAsk({
          kind: "email",
          head: "NEEDS YOUR OK BEFORE SENDING",
          line: `email ${i.to_name.toLowerCase()}?`,
          rows: [{ k: "TO", v: i.to_name.toLowerCase() }, { k: "ASK", v: i.ask_summary.toLowerCase() }, { k: "FROM", v: "your school mail" }],
          payload: { to: i.to_email, toName: i.to_name, subject: i.subject, body: i.body },
          threadId: thread.id,
        });
        thread.askId = ask.id;
        thread.status = "asking";
        thread.output = { file: `reply to ${i.to_name.toLowerCase()}.txt`, icon: "send", meta: "READY TO SEND", noteId: null };
        save(thread);
        return "Proposed. It is waiting for the student's OK; nothing has been sent.";
      },
    });

    const proposeSessions = betaZodTool({
      name: "propose_sessions",
      description: "Propose adding study sessions to the student's week. Nothing is added until they approve.",
      inputSchema: z.object({
        summary: z.string().min(1).max(60).describe("e.g. 'add six revision sessions?'"),
        sessions: z
          .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(1).max(60), mins: z.number().int().min(5).max(90), subject: z.string().max(24).optional() }))
          .min(1)
          .max(12),
        when: z.string().max(40).describe("short description of days, e.g. 'mon to thu'"),
        keeps: z.string().max(40).optional().describe("what stays clear, e.g. 'friday clear'"),
      }),
      run: async (i) => {
        step("spread the sessions");
        const ask = hub.createAsk({
          kind: "week",
          head: "CHANGES YOUR WEEK",
          line: i.summary.toLowerCase(),
          rows: [{ k: "WHEN", v: i.when.toLowerCase() }, ...(i.keeps ? [{ k: "KEEPS", v: i.keeps.toLowerCase() }] : [])],
          payload: { tasks: i.sessions },
          threadId: thread.id,
        });
        thread.askId = ask.id;
        thread.status = "asking";
        thread.output = { file: "next week", icon: "event_available", meta: "ON THE WALL", noteId: null };
        save(thread);
        return "Proposed. Waiting for the student's OK.";
      },
    });

    const proposeReminder = betaZodTool({
      name: "propose_reminder",
      description: "Propose a reminder that drops onto the wall at a set time. Waits for the student's OK.",
      inputSchema: z.object({ text: z.string().min(1).max(80), at_iso: z.string().describe("local date-time, e.g. 2026-09-28T16:10") }),
      run: async (i) => {
        const at = new Date(i.at_iso).getTime();
        if (!Number.isFinite(at)) return "bad time";
        step("set a reminder");
        const ask = hub.createAsk({
          kind: "reminder",
          head: "CHANGES YOUR WEEK",
          line: `remind you: ${i.text.toLowerCase()}?`,
          rows: [{ k: "WHEN", v: new Date(at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" }).toLowerCase() }],
          payload: { text: i.text, line: "", at },
          threadId: thread.id,
        });
        thread.askId = ask.id;
        thread.status = "asking";
        save(thread);
        return "Proposed. Waiting for the student's OK.";
      },
    });
    list.push(proposeEmail as never, proposeSessions as never, proposeReminder as never);
    return list;
  }

  async function execute(thread: AgentThread) {
    if (!client) return;
    const ac = new AbortController();
    running.set(thread.id, ac);
    const s = hub.settings();
    const sess = hub.session();
    const duringSession = thread.origin === "wall" && sess?.state === "running";
    const now = new Date();
    const context =
      `Now: ${now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. ` +
      `Student: ${s.ownerName}${s.yearGroup ? `, ${s.yearGroup}` : ""}. Parent: ${s.parentName}. ` +
      (s.profile ? `About them: ${s.profile.replace(/\s+/g, " ").trim()} ` : "") +
      `${MODE_NOTE[thread.mode]}` +
      (duringSession
        ? " The student is in a focus session right now. If the request is not about the current task, reply with exactly DEFER and nothing else."
        : "") +
      (thread.origin === "wall" ? " This will show on a tiny screen: answer in at most two short lines; anything longer goes to save_note." : "");
    try {
      if (thread.origin === "wall") o.say("progress_activity", "working on it", undefined, 30_000);
      const runner = client.beta.messages.toolRunner(
        {
          model: s.aiModel || "claude-opus-5",
          max_tokens: 16000,
          stream: false,
          // If the model declines, the API re-runs the request on a fallback model automatically.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
          output_config: { effort: thread.origin === "wall" ? "low" : "high" },
          tools: tools(thread, thread.mode),
          messages: [{ role: "user", content: `${context}\n\n${thread.prompt}` }],
          max_iterations: 12,
        },
        { signal: ac.signal },
      );
      for await (const msg of runner) {
        if (ac.signal.aborted) break;
        for (const b of msg.content) {
          if (b.type === "text" && b.text.trim() && msg.stop_reason !== "end_turn") {
            thread.log.push({ icon: "notes", text: b.text.trim() });
            save(thread);
          }
        }
        if (msg.stop_reason === "refusal") throw new Error("the assistant declined that one");
      }
      const final = await runner.done();
      const text = final.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (ac.signal.aborted) return;
      thread.steps.forEach((x) => (x.done = true));
      if (text === "DEFER") {
        hub.db.kvSet("deferred", [...hub.db.kvGet<string[]>("deferred", []), thread.prompt].slice(-5));
        thread.log.push({ icon: "block", text: "after this session" });
        thread.status = "done";
        save(thread);
        const cur = hub.session();
        const left = cur ? Math.max(1, Math.ceil(sessionView(cur, Date.now()).remaining / 60)) : 0;
        o.say("block", "after this session", left ? `${left} MINUTE${left === 1 ? "" : "S"}` : undefined, 3000);
        return;
      }
      // Every bypass attempt gets the same flat line. It never negotiates.
      if (text === "REFUSE") {
        thread.log.push({ icon: "lock", text: "That's in the parent app." });
        thread.status = "done";
        save(thread);
        if (thread.origin === "wall") o.say("lock", "cannot unlock the wall", "ASK A PARENT IN THEIR APP", 3000);
        return;
      }
      if (text) thread.log.push({ icon: "lightbulb", text });
      if (thread.status !== "asking") thread.status = "done";
      save(thread);
      if (thread.origin === "wall") {
        const lines = text.split(/(?<=[.!?])\s+/);
        if (thread.status === "asking") {
          /* the ask slab takes over */
        } else if (text.length > 90 || lines.length > 2) {
          if (!thread.output) {
            const n = hub.addNote({ kind: "note", label: thread.prompt.slice(0, 60), body: text, tags: [], secs: 0 });
            thread.output = { file: thread.prompt.slice(0, 40), icon: "bookmark_added", meta: "IN NOTES", noteId: n.id };
            save(thread);
          }
          o.say("bookmark_added", "saved to your notes", "READ IT AFTER THIS SESSION", 3000);
        } else if (text) {
          o.say("lightbulb", text.toLowerCase(), undefined, 5000);
        }
      }
      hub.feed("agent", `Asked the agent: ${thread.prompt.slice(0, 60)}`);
    } catch (e) {
      if (ac.signal.aborted) return;
      let msg = "something went wrong";
      if (e instanceof Anthropic.AuthenticationError) msg = "the Claude API key was rejected";
      else if (e instanceof Anthropic.RateLimitError) msg = "too many requests, try again in a minute";
      else if (e instanceof Anthropic.APIConnectionError) msg = "can't reach Claude — offline?";
      else if (e instanceof Anthropic.APIError) msg = `Claude error ${e.status}`;
      else if (e instanceof Error) msg = e.message;
      thread.status = "error";
      thread.error = msg;
      save(thread);
      if (thread.origin === "wall") o.say("help", "say that again?", undefined, 2600);
      o.log(`agent: ${msg}`);
    } finally {
      running.delete(thread.id);
    }
  }

  // Deferred questions get answered once the session is over.
  setInterval(() => {
    const d = hub.db.kvGet<string[]>("deferred", []);
    if (!d.length || hub.session()) return;
    hub.db.kvSet("deferred", []);
    for (const p of d) svc.run({ prompt: p, mode: "act", origin: "app" });
  }, 30_000).unref();

  const svc: AgentService = {
    available: () => !!client,
    run({ prompt, mode, origin }) {
      const t: AgentThread = {
        id: newId(), prompt, mode, origin, status: "working", steps: [], log: [], askId: null, output: null, error: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      save(t);
      void execute(t);
      return t.id;
    },
    stop(id) {
      running.get(id)?.abort();
      const t = hub.threads.get(id);
      if (t && (t.status === "working" || t.status === "asking")) {
        if (t.askId) hub.answerAsk(t.askId, false, "stopped");
        save({ ...t, status: "stopped" });
      }
    },
  };
  return svc;
}
