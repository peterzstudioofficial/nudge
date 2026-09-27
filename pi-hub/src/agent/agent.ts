import { z } from "zod";
import { type Llm, type Message, DEFAULT_MODEL, LlmError, serverToolsFor, type Citation } from "./llm";
import { type Tool, tool, parseArgs } from "./tools";
import { addDays, dueLabel, searchNotes, sessionView, type AgentThread, type AgentMode, parseDateKey, SUBJECT_NAMES, formTimeOn, matchTeacher, type Lesson } from "@nudge/shared";
import type { AgentService } from "../context";
import { type Hub, newId } from "../hub";
import { estimateBuild } from "../builder/builder";
import { spend } from "./spend";

/**
 * The Nudge assistant (a fast, cheap model on OpenRouter, zero data retention). It can read Peter's day, week, school mail/pages and notes.
 * It can never send, buy, delete or change the week by itself: those tools only create an
 * "ask" that waits for a yes on the wall, the desktop or the app. An approved email becomes a
 * ready-to-send draft on the computer — Peter presses send himself.
 */

/** A tool from outside (connected apps). `needsOk` decides per call whether it waits for a yes. */
export type GatedTool = Omit<Tool, "run"> & {
  run(args: unknown): Promise<string>;
  needsOk?(args: unknown): Promise<{ ok: false } | { ok: true; connector: string; args: unknown; label: string }>;
};

interface Opts {
  hub: Hub;
  llm: Llm | null;
  /** false while there's no key (it can be connected later from setup) */
  ready?: () => boolean;
  /** extra tools from connected apps (Composio) and the private search index */
  extraTools?: (mode: AgentMode, gate: (t: GatedTool) => Tool) => Promise<Tool[]>;
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
- Don't moralise or lecture about focus. Be neutral and factual.
- Web search (if you have it) is for public facts only: topics, exam boards, events, opening times. Never put the student's name, school, teachers, friends or anything from their notes or emails into a search query or a URL.
- Big jobs (building an app or tool, work on the computer) always go through build_tool or hand_to_claude: they show the cost and wait for a yes. Never try to do a big job inside a normal answer.
- If you have the tutor tool, use it only for genuinely hard explanations or plans; answer simple things yourself. Give it the question, never personal details.`;

const MODE_NOTE: Record<AgentMode, string> = {
  ask: "Mode: ASK. Answer only. Do not use any propose_* tool.",
  act: "Mode: ACT. You may use the propose_* tools; each one waits for the student's OK before anything happens.",
  watch: "Mode: WATCH. Only report what you find. Do not use any propose_* or save tool.",
};

export function agentService(o: Opts): AgentService {
  const { hub } = o;
  const client = o.llm;
  const running = new Map<string, AbortController>();

  /**
   * Tools from connected apps: reading runs straight away; anything that would send, post,
   * create, delete or change something becomes an ask showing exactly what would happen, and
   * only runs after a yes (see answerAsk → "connector").
   */
  const gateTool = (thread: AgentThread, t: GatedTool): Tool => {
    const makeAsk = (connector: string, args: unknown, label: string) => {
      const shown = JSON.stringify(args ?? {}).slice(0, 400);
      const ask = hub.createAsk({
        kind: "app",
        head: "NEEDS YOUR OK",
        line: `${label.toLowerCase().replace(/_/g, " ").slice(0, 60)}?`,
        rows: [{ k: "APP", v: connector.split("_")[0].toLowerCase() }, { k: "DOES", v: connector.toLowerCase().replace(/_/g, " ").slice(0, 40) }, { k: "WITH", v: shown.slice(0, 80) }],
        payload: { connector, args },
        threadId: thread.id,
      });
      thread.askId = ask.id;
      thread.status = "asking";
      save(thread);
      return "Proposed. Waiting for the student's OK; nothing has happened yet.";
    };
    if (t.needsOk) {
      const check = t.needsOk.bind(t);
      return {
        ...t,
        kind: "read",
        async run(args) {
          const need = await check(args);
          if (!need.ok) return t.run(args);
          if (thread.mode !== "act") return "error: that would change something in the app, which isn't allowed in this mode. Tell the student what you'd do instead.";
          return makeAsk(need.connector, need.args, need.label);
        },
      };
    }
    if (t.kind === "read") return t as Tool;
    return { ...t, kind: "ask", run: async (args) => makeAsk(t.name, args, t.description.split(/[.:]/)[0]) };
  };

  const save = (t: AgentThread) => {
    hub.threads.put({ ...t, updatedAt: Date.now() });
    hub.bus.changed("agent");
  };

  function tools(thread: AgentThread, mode: AgentMode): Tool[] {
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

    const getToday = tool(
      "get_today",
      "Today's date, school week (A/B), what kind of day it is, form time, the lessons with times, rooms and teachers, school calendar dates today, the task list with progress, and the focus session if one is running.",
      z.object({}),
      "read",
      async () => {
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
          commitments: hub.activitiesOn(d).map((a) => `${a.start}-${a.end} ${a.name}${a.where ? " (" + a.where + ")" : ""}`),
          tasks: hub.listTasks(d).map(openTask),
          session: s ? { task: hub.tasks.get(s.taskId)?.name, state: s.state } : null,
        });
      },
    );

    const getWeek = tool(
      "get_week",
      "The next 7 days: day kinds (school / weekend / half term / holiday / away), week A/B, lessons, school calendar dates, tasks already planned (with homework due dates), and free evenings.",
      z.object({}),
      "read",
      async () => {
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
            commitments: hub.activitiesOn(d).map((a) => `${a.start}-${a.end} ${a.name}`),
            planned_minutes: tasks.reduce((a, t) => a + t.mins, 0),
            tasks: tasks.map(openTask),
          });
        }
        return JSON.stringify(out);
      },
    );

    const getSchool = tool(
      "get_school_items",
      "Recent school emails (sender, subject, preview) and school web page sections, newest first. Optionally filter by words.",
      z.object({ query: z.string().max(80).optional() }),
      "read",
      async ({ query }) => {
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
    );

    const findNotes = tool(
      "search_notes",
      "Search the student's own notes and voice-note transcripts.",
      z.object({ query: z.string().min(1).max(80) }),
      "read",
      async ({ query }) => {
        step("checking notes");
        return JSON.stringify(searchNotes(hub.listNotes(), query).slice(0, 8).map((n) => ({ title: n.label, body: n.body.slice(0, 500) })));
      },
    );

    const getCalendar = tool(
      "get_school_calendar",
      "School calendar dates that matter to the student (term dates, their year group, exams and mocks, parents' evenings, creative events) for the coming weeks. Optionally filter by words.",
      z.object({ days: z.number().int().min(1).max(200).default(60), query: z.string().max(80).optional() }),
      "read",
      async ({ days, query }) => {
        step("check the school calendar");
        const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const list = hub.upcomingEvents(today(), days).filter((e) => !words.length || words.some((w) => e.title.toLowerCase().includes(w)));
        return JSON.stringify(list.slice(0, 40).map((e) => ({ date: e.date, weekday: parseDateKey(e.date).toLocaleDateString("en-GB", { weekday: "short" }), time: e.time, title: e.title, tags: e.tags })));
      },
    );

    const getTeachers = tool(
      "get_teachers",
      "The student's own teachers (subject, timetable code, name) and, if asked, a search of the school staff list by name, subject or job. Use before drafting an email to a teacher. Email addresses are not in the list — never guess one.",
      z.object({ query: z.string().max(60).optional() }),
      "read",
      async ({ query }) => {
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
    );

    const list: Tool[] = [getToday, getWeek, getSchool, findNotes, getCalendar, getTeachers];
    list.push(
      tool("my_tools", "The tools (small apps) already built for the student, with their ids.", z.object({}), "read", async () =>
        JSON.stringify(hub.listTools().map((t) => ({ id: t.id, title: t.title, description: t.description, for: t.target, updated: new Date(t.updatedAt).toISOString().slice(0, 10) }))),
      ),
    );
    if (mode === "watch") return list;

    const saveNote = tool(
      "save_note",
      "Save an answer or explanation to the student's notes app so they can read it later. Use this for anything longer than two short sentences.",
      z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(8000) }),
      "save",
      async ({ title, body }) => {
        step("save to notes");
        const n = hub.addNote({ kind: "note", label: title, body, tags: [], secs: 0 });
        thread.output = { file: title.toLowerCase(), icon: "bookmark_added", meta: "IN NOTES", noteId: n.id };
        save(thread);
        if (thread.origin === "wall") o.say("bookmark_added", "saved to your notes", "READ IT AFTER THIS SESSION", 3000);
        return "saved";
      },
    );
    list.push(saveNote);
    if (mode === "ask") return list;

    const proposeEmail = tool(
      "propose_email",
      "Draft an email from the student to a teacher. This does NOT send anything: it asks the student to approve, then opens it ready in their school Outlook for them to press send.",
      z.object({
        to_email: z.string().email().describe("recipient email address, taken from a school email you read"),
        to_name: z.string().min(1).max(60).describe("short name, e.g. 'mr hale'"),
        subject: z.string().min(1).max(120),
        body: z.string().min(1).max(3000),
        ask_summary: z.string().min(1).max(60).describe("what the email asks for, in a few words, e.g. 'two more days'"),
      }),
      "ask",
      async (i) => {
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
    );

    const proposeSessions = tool(
      "propose_sessions",
      "Propose adding study sessions to the student's week. Nothing is added until they approve.",
      z.object({
        summary: z.string().min(1).max(60).describe("e.g. 'add six revision sessions?'"),
        sessions: z
          .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(1).max(60), mins: z.number().int().min(5).max(90), subject: z.string().max(24).optional() }))
          .min(1)
          .max(12),
        when: z.string().max(40).describe("short description of days, e.g. 'mon to thu'"),
        keeps: z.string().max(40).optional().describe("what stays clear, e.g. 'friday clear'"),
      }),
      "ask",
      async (i) => {
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
    );

    const proposeReminder = tool(
      "propose_reminder",
      "Propose a reminder that drops onto the wall at a set time. Waits for the student's OK.",
      z.object({ text: z.string().min(1).max(80), at_iso: z.string().describe("local date-time, e.g. 2026-09-28T16:10") }),
      "ask",
      async (i) => {
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
    );
    list.push(proposeEmail, proposeSessions, proposeReminder);

    // Build a tool (a small offline web app) — a big job, so it's confirmed with its cost first.
    const pcBuild = hub.claudeDesktop();
    const buildWhere = pcBuild?.cli && pcBuild.allowRun ? (["pi", "computer"] as const) : (["pi"] as const);
    list.push(
      tool(
        "build_tool",
        "Build the student a small app/tool (e.g. flashcards, a line-learner for rehearsals, a revision timer, a set-list organiser). " +
          "It becomes an offline web app in the Tools tab on their phone, installable like an app. It's a big job: it's shown with its cost and only starts after they say yes. " +
          "where: 'pi' = a cheap model builds and tests it in a sandbox" +
          (buildWhere.length > 1 ? "; 'computer' = Claude Code on their PC builds it (for bigger or trickier things)" : "") +
          ". when: 'now', or 'later' (half price, usually ready within the hour). Write the brief as a full spec: screens, features, what data it keeps. Use improve_tool_id to change an existing tool (see my_tools).",
        z.object({
          title: z.string().min(2).max(60),
          brief: z.string().min(20).max(6000),
          target: z.enum(["phone", "school", "any"]),
          when: z.enum(["now", "later"]),
          where: z.enum(buildWhere as unknown as [string, ...string[]]),
          improve_tool_id: z.string().max(40).optional(),
        }),
        "ask",
        async (i) => {
          if (i.improve_tool_id && !hub.tools.get(i.improve_tool_id)) return "error: no tool with that id (see my_tools)";
          step("plan the build");
          const request = { title: i.title, brief: i.brief, target: i.target as "phone" | "school" | "any", when: i.when as "now" | "later", where: i.where as "pi" | "computer", toolId: i.improve_tool_id ?? null, attachments: [] };
          const est = estimateBuild(request);
          const ask = hub.createAsk({
            kind: "build",
            head: "BIG JOB · ARE YOU SURE?",
            line: `${i.improve_tool_id ? "improve" : "build"} ${i.title.toLowerCase()}?`,
            rows: [
              { k: "WHERE", v: i.where === "computer" ? "claude code on your pc" : "the pi, in a sandbox" },
              { k: "WHEN", v: i.when === "later" ? "later · half price" : "now · a few minutes" },
              { k: "COST", v: i.where === "computer" ? "your claude plan" : `about $${Math.max(est, 0.001).toFixed(3)}` },
            ],
            payload: { request, estUsd: est },
            threadId: thread.id,
          });
          thread.askId = ask.id;
          thread.status = "asking";
          save(thread);
          return `Proposed (about $${est.toFixed(3)}). Waiting for the student's OK; nothing has started.`;
        },
      ),
    );

    // Hand bigger computer jobs to Claude on Peter's PC (only if the desktop app says it can).
    const pc = hub.claudeDesktop();
    if (pc && (pc.desktopApp || (pc.cli && pc.allowRun))) {
      const targets = [...(pc.desktopApp ? (["cowork", "code"] as const) : []), ...(pc.cli && pc.allowRun ? (["code_run"] as const) : [])];
      const folders = pc.workspaces;
      list.push(
        tool(
          "hand_to_claude",
          "Hand a bigger job to Claude on the student's computer, after they say yes. " +
            "'cowork' opens Claude Cowork (documents, research, files) and 'code' opens Claude Code, both with the task typed in for the student to check and send. " +
            (pc.cli && pc.allowRun
              ? `'code_run' runs Claude Code right away in one of their project folders (${pc.runMode === "plan" ? "it can read and plan but not change files" : "it can edit files there"}); the computer asks them again first. `
              : "") +
            "Write the task as clear, complete instructions. Include only what the job needs: no passwords, no personal details, nothing from school emails unless the job is about them." +
            (folders.length ? ` Folders set up: ${folders.join(", ")}.` : ""),
          z.object({
            target: z.enum(targets as unknown as [string, ...string[]]),
            task: z.string().min(10).max(4000),
            folder: (folders.length ? z.enum(folders as [string, ...string[]]) : z.string().max(0)).optional().describe("one of the folders set up on the computer"),
            summary: z.string().min(1).max(60).describe("what it's for, in a few words"),
          }),
          "ask",
          async (i) => {
            if (i.target === "code_run" && !i.folder) return "error: code_run needs one of the folders";
            step("hand it to claude");
            const where = i.target === "cowork" ? "claude cowork" : i.target === "code" ? "claude code (you press send)" : `claude code runs it${pc.runMode === "plan" ? " (read-only)" : ""}`;
            const ask = hub.createAsk({
              kind: "claude",
              head: "ON YOUR COMPUTER",
              line: `hand to claude: ${i.summary.toLowerCase()}?`,
              rows: [
                { k: "WHERE", v: where },
                ...(i.folder ? [{ k: "FOLDER", v: i.folder }] : []),
                { k: "TASK", v: i.task.slice(0, 80) },
              ],
              payload: { target: i.target, task: i.task, workspace: i.folder ?? null, threadId: thread.id },
              threadId: thread.id,
            });
            thread.askId = ask.id;
            thread.status = "asking";
            save(thread);
            return "Proposed. Waiting for the student's OK; nothing has happened yet.";
          },
        ),
      );
    }
    return list;
  }

  /** The per-question context: time, who the student is, the mode and the session rule. */
  function contextFor(thread: AgentThread): string {
    const s = hub.settings();
    const sess = hub.session();
    const duringSession = thread.origin === "wall" && sess?.state === "running";
    const now = new Date();
    return (
      `Now: ${now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. ` +
      `Student: ${s.ownerName}${s.yearGroup ? `, ${s.yearGroup}` : ""}. Parent: ${s.parentName}. ` +
      (s.profile ? `About them: ${s.profile.replace(/\s+/g, " ").trim()} ` : "") +
      `${MODE_NOTE[thread.mode]}` +
      (duringSession
        ? " The student is in a focus session right now. If the request is not about the current task, reply with exactly DEFER and nothing else."
        : "") +
      (thread.origin === "wall" ? " This will show on a tiny screen: answer in at most two short lines; anything longer goes to save_note." : "")
    );
  }

  async function allTools(thread: AgentThread): Promise<Tool[]> {
    const list = tools(thread, thread.mode);
    if (o.extraTools) list.push(...(await o.extraTools(thread.mode, (t) => gateTool(thread, t))));
    return list;
  }

  /** What happens with the final answer: DEFER / REFUSE mapped to their slabs, long answers to notes. */
  function finish(thread: AgentThread, text: string) {
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
  }

  function newThread(prompt: string, mode: AgentMode, origin: AgentThread["origin"]): AgentThread {
    const t: AgentThread = {
      id: newId(), prompt, mode, origin, status: "working", steps: [], log: [], askId: null, output: null, error: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    save(t);
    return t;
  }

  async function execute(thread: AgentThread) {
    if (!client) return;
    const ac = new AbortController();
    running.set(thread.id, ac);
    const context = contextFor(thread);
    try {
      if (thread.origin === "wall") o.say("progress_activity", "working on it", undefined, 30_000);
      const list = await allTools(thread);
      const byName = new Map(list.map((t) => [t.name, t]));
      const messages: Message[] = [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${context}\n\n${thread.prompt}` },
      ];
      let text = "";
      const s = hub.settings();
      const wall = thread.origin === "wall";
      // Monthly budget: stop before going over it.
      if (spend(hub).usd >= s.aiBudgetUsd) {
        finish(thread, `This month's AI budget ($${s.aiBudgetUsd}) is used up. You can raise it in setup.`);
        return;
      }
      let spent = 0;
      const cap = wall ? 0.02 : 0.06;
      const serverTools = serverToolsFor(s, { wall });
      const specs = list.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
      const cites = new Map<string, Citation>();
      for (let turn = 0; turn < 10 && !ac.signal.aborted; turn++) {
        const r = await client.chat({
          messages,
          tools: specs,
          serverTools,
          maxTokens: wall ? 500 : 2000,
          model: s.aiModel || DEFAULT_MODEL,
          effort: wall ? "minimal" : "low",
          sessionId: thread.id,
          maxToolCostUsd: wall ? 0.01 : 0.03,
          signal: ac.signal,
        });
        for (const c of r.citations) cites.set(c.url, c);
        spent += r.cost;
        if (spent > cap && r.toolCalls.length) {
          // One question shouldn't cost more than a few pence: stop and say so.
          text = r.content || "That was getting pricey, so I stopped there. Ask again (or ask for it as a build) if you want me to keep going.";
          break;
        }
        if (r.serverToolCalls && !thread.steps.some((x) => x.text === "looked it up")) {
          thread.steps.forEach((x) => (x.done = true));
          thread.steps.push({ text: "looked it up", meta: r.citations.length ? `${r.citations.length} SOURCES` : "", done: false });
          save(thread);
        }
        messages.push({ role: "assistant", content: r.content || null, ...(r.toolCalls.length ? { tool_calls: r.toolCalls } : {}) });
        if (!r.toolCalls.length) {
          text = r.content;
          break;
        }
        if (r.content) {
          thread.log.push({ icon: "notes", text: r.content });
          save(thread);
        }
        // Read tools run side by side; anything that makes an ask runs one at a time, in order.
        const runOne = async (call: (typeof r.toolCalls)[number]) => {
          const t = byName.get(call.function.name);
          try {
            return t ? await t.run(parseArgs(call.function.arguments)) : `error: no tool called ${call.function.name}`;
          } catch (e) {
            return `error: ${(e as Error).message}`.slice(0, 300);
          }
        };
        const results = new Map<string, string>();
        const reads = r.toolCalls.filter((c) => byName.get(c.function.name)?.kind === "read");
        await Promise.all(reads.map(async (c) => results.set(c.id, await runOne(c))));
        for (const c of r.toolCalls) if (!results.has(c.id)) results.set(c.id, await runOne(c));
        for (const c of r.toolCalls) messages.push({ role: "tool", tool_call_id: c.id, content: results.get(c.id)!.slice(0, 12_000) });
        if (thread.status === "asking") {
          // An ask is waiting for a yes: stop here, the student answers on the wall or the app.
          text = "";
          break;
        }
      }
      if (ac.signal.aborted) return;
      if (cites.size && text && text !== "DEFER" && text !== "REFUSE") {
        thread.log.push({ icon: "public", text: [...cites.values()].slice(0, 5).map((c) => `${c.title} — ${c.url}`).join("\n") });
      }
      finish(thread, text);
    } catch (e) {
      if (ac.signal.aborted) return;
      let msg = "something went wrong";
      if (e instanceof LlmError || e instanceof Error) msg = e.message;
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
    available: () => !!client && (o.ready?.() ?? true),
    run({ prompt, mode, origin }) {
      const t = newThread(prompt, mode, origin);
      void execute(t);
      return t.id;
    },
    async tidyNote(text) {
      if (!client || !hub.settings().ai || !text.trim()) return null;
      const r = await client.chat({
        messages: [
          { role: "system", content: "Give a short title (max 6 words, lower case, no full stop) and up to 3 one-word lower-case tags for this voice note by a UK school student. Tags from: school, homework, revision, music, drama, film, idea, todo, personal, or a subject name." },
          { role: "user", content: text.slice(0, 4000) },
        ],
        json: {
          name: "note",
          schema: {
            type: "object",
            properties: { title: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
            required: ["title", "tags"],
            additionalProperties: false,
          },
        },
        maxTokens: 120,
        effort: "none",
        model: hub.settings().aiModel || DEFAULT_MODEL,
      });
      try {
        const j = JSON.parse(r.content) as { title?: unknown; tags?: unknown };
        const label = typeof j.title === "string" ? j.title.trim().slice(0, 60) : "";
        const tags = Array.isArray(j.tags) ? j.tags.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20)).filter(Boolean).slice(0, 3) : [];
        return label ? { label, tags } : null;
      } catch {
        return null;
      }
    },
    /** For the voice assistant: same tools, same rules, same finish — a different model drives it. */
    async voiceTurn() {
      const thread = newThread("(voice)", "act", "wall");
      return {
        thread,
        system: SYSTEM,
        context: contextFor(thread),
        tools: await allTools(thread),
        finish: (heard: string, text: string) => {
          thread.prompt = heard.slice(0, 300) || "(voice)";
          finish(thread, text.trim());
        },
        fail: (msg: string) => {
          thread.status = "error";
          thread.error = msg;
          save(thread);
        },
      };
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
