import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Core vocabulary shared by the hub, the wall screen and every app. */
/* ------------------------------------------------------------------ */

export const Role = z.enum(["owner", "parent", "screen", "desktop"]);
export type Role = z.infer<typeof Role>;

/** Where a task sits in the day. Mirrors the four phases on the wall's progress bar. */
export const Phase = z.enum(["home", "study", "mine", "bag"]);
export type Phase = z.infer<typeof Phase>;

export const TaskSource = z.enum(["parent", "school", "note", "agent", "self", "template"]);
export type TaskSource = z.infer<typeof TaskSource>;

export const DayKind = z.enum(["school", "weekend", "halfterm", "holiday", "away", "sick"]);
export type DayKind = z.infer<typeof DayKind>;

export const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
export const DateKey = z.string().regex(dateKeyRe, "expected YYYY-MM-DD");

const name = z.string().trim().min(1).max(80);
const longText = z.string().max(20_000);

export const Task = z.object({
  id: z.string(),
  date: DateKey,
  name,
  subject: z.string().max(24),
  phase: Phase,
  mins: z.number().int().min(1).max(240),
  source: TaskSource,
  order: z.number(),
  done: z.boolean(),
  doneAt: z.number().nullable(),
  /** true once the +1 start point has been given. Never reset. */
  started: z.boolean(),
  /** seconds of real work kept against this task (survives switching / pausing) */
  spentSec: z.number().int().min(0),
  note: z.string().max(200).default(""),
  /** homework the timetable says was probably set today; "not set" removes it for free */
  expected: z.boolean().optional(),
  /** when it's handed in (homework) */
  due: DateKey.nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Task = z.infer<typeof Task>;

export const NewTask = z.object({
  date: DateKey.optional(),
  name,
  subject: z.string().max(24).default("mine"),
  phase: Phase.default("home"),
  mins: z.number().int().min(1).max(240).default(25),
  note: z.string().max(200).default(""),
  when: z.enum(["today", "tomorrow", "date"]).default("tomorrow"),
});
export type NewTask = z.infer<typeof NewTask>;

export const TaskPatch = z.object({
  name: name.optional(),
  subject: z.string().max(24).optional(),
  phase: Phase.optional(),
  mins: z.number().int().min(1).max(240).optional(),
  note: z.string().max(200).optional(),
  order: z.number().optional(),
  date: DateKey.optional(),
});
export type TaskPatch = z.infer<typeof TaskPatch>;

/** Weekly repeating task, set in the parent app. Materialised into each matching day. */
export const Template = z.object({
  id: z.string(),
  name,
  subject: z.string().max(24),
  phase: Phase,
  mins: z.number().int().min(1).max(240),
  /** ISO weekdays 1 = Monday … 7 = Sunday */
  days: z.array(z.number().int().min(1).max(7)).min(1),
  /** only on school days (skips holidays / half term) */
  schoolDaysOnly: z.boolean().default(true),
  createdAt: z.number(),
});
export type Template = z.infer<typeof Template>;

export const NewTemplate = Template.omit({ id: true, createdAt: true });

export const BagItem = z.object({
  id: z.string(),
  /** the school day this bag is for */
  date: DateKey,
  name,
  subject: z.string().max(24),
  note: z.string().max(60).default(""),
  /** always lives in the bag (planner, calculator) */
  kept: z.boolean(),
  got: z.boolean(),
  skipped: z.boolean(),
  source: TaskSource,
  order: z.number(),
});
export type BagItem = z.infer<typeof BagItem>;

export const NewBagItem = z.object({
  date: DateKey.optional(),
  name,
  subject: z.string().max(24).default("mine"),
  note: z.string().max(60).default(""),
  kept: z.boolean().default(false),
});

/** The live focus session. There is at most one. Lives on the hub so every screen agrees. */
export const SessionState = z.enum(["running", "paused", "break"]);
export const Session = z.object({
  taskId: z.string(),
  state: SessionState,
  totalSec: z.number().int(),
  /** work seconds banked before `runningSince` */
  workedSec: z.number().int(),
  runningSince: z.number().nullable(),
  startedAt: z.number(),
  breakUntil: z.number().nullable(),
  /** server clock at the time this snapshot was produced, for client clock skew */
  now: z.number(),
});
export type Session = z.infer<typeof Session>;

export const PointEntry = z.object({
  id: z.string(),
  ts: z.number(),
  delta: z.number().int().positive(),
  reason: z.enum(["start", "claim", "bag", "bonus"]),
  taskId: z.string().nullable(),
});
export type PointEntry = z.infer<typeof PointEntry>;

export const Reward = z.object({
  id: z.string(),
  name,
  icon: z.string().max(40),
  goal: z.number().int().min(5).max(1000),
  /** total lifetime points at the moment this reward became current */
  startPoints: z.number().int(),
  unlockedAt: z.number().nullable(),
  ackedAt: z.number().nullable(),
});
export type Reward = z.infer<typeof Reward>;

export const FeedEvent = z.object({
  id: z.string(),
  ts: z.number(),
  type: z.string(),
  text: z.string(),
});
export type FeedEvent = z.infer<typeof FeedEvent>;

export const NoteKind = z.enum(["note", "voice", "task"]);
export const Note = z.object({
  id: z.string(),
  kind: NoteKind,
  label: z.string().max(120),
  body: longText,
  tags: z.array(z.string().max(30)).max(30),
  secs: z.number().int().min(0).default(0),
  hasAudio: z.boolean().default(false),
  wall: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Note = z.infer<typeof Note>;

export const NewNote = z.object({
  id: z.string().max(64).optional(),
  kind: NoteKind.default("note"),
  label: z.string().trim().max(120).default(""),
  body: longText.default(""),
  tags: z.array(z.string().max(30)).max(30).default([]),
  secs: z.number().int().min(0).default(0),
});

export const NotePatch = z.object({
  kind: NoteKind.optional(),
  label: z.string().trim().max(120).optional(),
  body: longText.optional(),
  tags: z.array(z.string().max(30)).max(30).optional(),
});

export const ToWall = z.object({
  as: z.enum(["reminder", "task"]),
  /** epoch ms when it should arrive on the wall */
  at: z.number(),
});

export const Reminder = z.object({
  id: z.string(),
  text: z.string().max(120),
  line: z.string().max(200),
  at: z.number(),
  shownAt: z.number().nullable(),
  noteId: z.string().nullable(),
  source: TaskSource,
});
export type Reminder = z.infer<typeof Reminder>;

export const SchoolItemKind = z.enum(["homework", "bring", "deadline", "event", "info"]);
export const SchoolItem = z.object({
  id: z.string(),
  source: z.enum(["mail", "page"]),
  sourceRef: z.string(),
  title: z.string(),
  from: z.string(),
  preview: z.string(),
  url: z.string(),
  receivedAt: z.number(),
  kind: SchoolItemKind,
  due: DateKey.nullable(),
  subject: z.string().nullable(),
  handled: z.boolean(),
  action: z.string().nullable(),
  createdAt: z.number(),
});
export type SchoolItem = z.infer<typeof SchoolItem>;

export const SchoolAction = z.object({
  type: z.enum(["task", "bag", "remind", "note", "dismiss", "undo"]),
  /** optional overrides chosen in the UI */
  name: z.string().max(80).optional(),
  date: DateKey.optional(),
  mins: z.number().int().min(1).max(240).optional(),
});

/** Anything the assistant wants to do that leaves the device or changes the week waits here. */
export const AskStatus = z.enum(["pending", "approved", "declined", "done", "expired"]);
export const Ask = z.object({
  id: z.string(),
  kind: z.enum(["email", "week", "reminder", "task", "app", "claude", "build"]),
  line: z.string(),
  head: z.string(),
  rows: z.array(z.object({ k: z.string(), v: z.string() })),
  payload: z.record(z.string(), z.unknown()),
  status: AskStatus,
  threadId: z.string().nullable(),
  createdAt: z.number(),
  answeredAt: z.number().nullable(),
  answeredBy: z.string().nullable(),
});
export type Ask = z.infer<typeof Ask>;

/**
 * Anything that leaves the house (an email, a message or post in a connected app, work on the
 * computer, a paid build) can't be approved with a tap: it has to be held down, and not in the
 * first moment it appears. The hub enforces this; the wall and the apps show a fill-to-hold key.
 */
export const HOLD_KINDS: readonly Ask["kind"][] = ["email", "app", "claude", "build"];
export const HOLD_MS = 1200;
export const HOLD_MIN_SHOWN_MS = 1500;
export const askNeedsHold = (a: Pick<Ask, "kind">): boolean => HOLD_KINDS.includes(a.kind);

/** Something the assistant has learned about the owner (their "brain"). Owner-only; editable. */
export const Memory = z.object({
  id: z.string(),
  text: z.string().min(2).max(200),
  /** "told": they said it; "noticed": the assistant picked it up from what they asked */
  source: z.enum(["told", "noticed"]),
  createdAt: z.number(),
  usedAt: z.number(),
});
export type Memory = z.infer<typeof Memory>;

export const AgentMode = z.enum(["ask", "act", "watch"]);
export type AgentMode = z.infer<typeof AgentMode>;

export const AgentStep = z.object({ text: z.string(), meta: z.string(), done: z.boolean() });
export const AgentLog = z.object({ icon: z.string(), text: z.string(), code: z.string().optional() });
export const AgentThread = z.object({
  id: z.string(),
  prompt: z.string(),
  mode: AgentMode,
  origin: z.enum(["desktop", "wall", "app"]),
  status: z.enum(["working", "asking", "done", "stopped", "error"]),
  steps: z.array(AgentStep),
  log: z.array(AgentLog),
  askId: z.string().nullable(),
  output: z.object({ file: z.string(), icon: z.string(), meta: z.string(), noteId: z.string().nullable() }).nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type AgentThread = z.infer<typeof AgentThread>;

/** A job the desktop must finish by hand, e.g. an email opened ready in Outlook for Peter to send. */
/**
 * Work handed to Claude on Peter's computer, after a yes:
 * - "cowork" / "code": opens Claude Desktop (Cowork or Code) with the task typed in, not sent
 * - "code_run": runs Claude Code headless in one of the folders set up on the PC, after the PC
 *   itself asks too. Only folder names are known to the hub; paths stay on the PC.
 */
export const ClaudeTarget = z.enum(["cowork", "code", "code_run"]);
export type ClaudeTarget = z.infer<typeof ClaudeTarget>;
export const ClaudeTask = z.object({
  target: ClaudeTarget,
  task: z.string().min(1).max(5000),
  workspace: z.string().max(40).nullable(),
  threadId: z.string().nullable(),
  /** set when this is a build job: the PC builds in its Nudge Builds folder and sends the tool back */
  jobId: z.string().nullable().optional(),
});
export type ClaudeTask = z.infer<typeof ClaudeTask>;
/** What the PC says it can do (sent by the desktop app). */
export const ClaudeDesktop = z.object({
  workspaces: z.array(z.string().min(1).max(40)).max(20),
  desktopApp: z.boolean(),
  cli: z.boolean(),
  allowRun: z.boolean(),
  runMode: z.enum(["plan", "acceptEdits"]),
  /** Peter switched on "answer with my Claude plan" on this computer */
  chat: z.boolean().default(false),
});
export type ClaudeDesktop = z.infer<typeof ClaudeDesktop>;

const HandoffBase = { id: z.string(), createdAt: z.number(), doneAt: z.number().nullable() };
export const Handoff = z.discriminatedUnion("kind", [
  z.object({ ...HandoffBase, kind: z.literal("compose"), payload: z.object({ to: z.string(), subject: z.string(), body: z.string() }) }),
  z.object({ ...HandoffBase, kind: z.literal("claude"), payload: ClaudeTask }),
  /** a question for the ongoing Claude chat on the PC (his own Claude plan), answered back to the thread */
  z.object({ ...HandoffBase, kind: z.literal("chat"), payload: z.object({ threadId: z.string(), prompt: z.string().max(4000), context: z.string().max(8000), system: z.string().max(8000) }) }),
]);
export type Handoff = z.infer<typeof Handoff>;

export const Period = z.object({
  subject: z.string().max(24),
  span: z.number().int().min(1).max(3),
  room: z.string().max(12).optional(),
  /** teacher code as printed on the timetable, e.g. "NEC" */
  teacher: z.string().max(8).optional(),
});
export type Period = z.infer<typeof Period>;
/**
 * Keyed by ISO weekday: "A1".."A5" and "B1".."B5" for a two-week timetable, or plain "1".."5"
 * when every week is the same. Week-specific keys win.
 */
export const Timetable = z.record(z.string().regex(/^[AB]?[1-7]$/), z.array(Period).max(10));
export type Timetable = z.infer<typeof Timetable>;

const hm = z.string().regex(/^\d{2}:\d{2}$/);
/** The school's bell times. Lessons in the timetable fill these slots in order (a double takes two). */
export const SchoolDay = z.object({
  reg: z.object({ start: hm, end: hm }),
  slots: z.array(z.object({ start: hm, end: hm })).min(1).max(10),
  breaks: z.array(z.object({ label: z.string().max(20), start: hm, end: hm })).max(6),
});
export type SchoolDay = z.infer<typeof SchoolDay>;

/** What happens in registration / form time, keyed by ISO weekday "1".."5". */
export const FormTime = z.record(z.string().regex(/^[1-5]$/), z.string().max(40));
export type FormTime = z.infer<typeof FormTime>;

/** Which subjects set homework on which day. Same keys as the timetable ("A1", "B4" or "3"). */
export const HomeworkPlan = z.object({
  days: z.record(z.string().regex(/^[AB]?[1-7]$/), z.array(z.string().max(24)).max(8)),
  /** most minutes of homework per subject per week; split between the times it's set */
  weeklyMinsPerSubject: z.number().int().min(10).max(240),
  on: z.boolean(),
});
export type HomeworkPlan = z.infer<typeof HomeworkPlan>;

/** Staff directory (stays on the Pi; owner devices only). */
export const Teacher = z.object({
  name: z.string().max(60),
  role: z.string().max(160),
  /** timetable code if known, e.g. "NEC" */
  code: z.string().max(8).optional(),
});
export type Teacher = z.infer<typeof Teacher>;

/** A weekly commitment in term time: a club, rehearsals, a lesson outside school. */
export const Activity = z.object({
  id: z.string(),
  name: z.string().max(60),
  /** ISO weekdays */
  days: z.array(z.number().int().min(1).max(7)).min(1),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  where: z.string().max(40).default(""),
  /** only in term time (not half term / holidays) */
  termOnly: z.boolean().default(true),
});
export type Activity = z.infer<typeof Activity>;

/** A date from the school calendar (or added by hand). */
export const CalEvent = z.object({
  id: z.string(),
  date: DateKey,
  time: hm.nullable(),
  title: z.string().max(160),
  /** "term", "5th year", "exam", "parents", "creative", "house", "school" … */
  tags: z.array(z.string().max(20)).max(6),
  source: z.enum(["calendar", "self"]),
});
export type CalEvent = z.infer<typeof CalEvent>;

export const Birthday = z.object({ name: z.string().max(40), date: z.string().regex(/^\d{2}-\d{2}$/) });
export type Birthday = z.infer<typeof Birthday>;

export const TermDate = z.object({
  /** e.g. "Autumn 2026" */
  term: z.string(),
  start: DateKey,
  end: DateKey,
  /** inclusive ranges with no school inside the term */
  breaks: z.array(z.object({ label: z.string(), start: DateKey, end: DateKey })),
  confirmed: z.boolean(),
  note: z.string().default(""),
  /** two-week timetables: the letter of the term's first teaching week (default A) */
  abStart: z.enum(["A", "B"]).optional(),
});
export type TermDate = z.infer<typeof TermDate>;

export const NfcAction = z.enum(["home", "desk", "morning", "break", "homework", "bag"]);
export const Settings = z.object({
  ownerName: z.string().max(40),
  parentName: z.string().max(40),
  /** assistant on/off (design: settings › assistant) */
  ai: z.boolean(),
  wakeWord: z.boolean(),
  iconKeys: z.boolean(),
  dimAtNight: z.boolean(),
  quietAfter11: z.boolean(),
  reminders: z.boolean(),
  brightness: z.number().int().min(0).max(4),
  lieInWeekends: z.boolean(),
  leaveForSchool: z.string().regex(/^\d{2}:\d{2}$/),
  alarm: z.string().regex(/^\d{2}:\d{2}$/),
  bedtime: z.string().regex(/^\d{2}:\d{2}$/),
  defaultMins: z.number().int().min(5).max(120),
  breakMins: z.number().int().min(1).max(30),
  skipsPerDay: z.number().int().min(0).max(5),
  maxTasksPerDay: z.number().int().min(1).max(12),
  pointsStart: z.number().int().min(0).max(10),
  pointsClaim: z.number().int().min(0).max(20),
  location: z.object({ name: z.string(), lat: z.number(), lon: z.number() }),
  newsFeed: z.string().url().or(z.literal("")),
  blockList: z.array(z.string().max(80)).max(100),
  studyOnlySites: z.array(z.string().max(80)).max(20),
  /** computer apps kept out of the way during a session (process names, e.g. "steam") */
  blockApps: z.array(z.string().max(60)).max(60),
  /** blocked sites/apps that open while the task is for one of these subjects (Pinterest for art) */
  focusAllow: z.array(z.object({ name: z.string().min(2).max(80), subjects: z.array(z.string().max(24)).min(1).max(20) })).max(40),
  nfcTags: z.record(z.string(), NfcAction),
  schoolPages: z.array(z.object({ label: z.string().max(40), url: z.string().url() })).max(10),
  schoolMail: z.boolean(),
  schoolMailSenders: z.array(z.string().max(120)).max(50),
  aiModel: z.string().max(60),
  /** let the assistant search and read the web (OpenRouter server tools) */
  webSearch: z.boolean(),
  /** stronger model the assistant may consult on hard questions ("" = off) */
  aiAdvisorModel: z.string().max(60),
  /** model that writes tools (cheap, good at code) */
  buildModel: z.string().max(60),
  /** the most the cloud AI may spend in a month, in US dollars; it stops at the limit */
  aiBudgetUsd: z.number().min(0.5).max(100),
  /** who answers typed questions from the phone and computer: cheap models on OpenRouter, or one
   *  ongoing chat with Claude on Peter's computer, on his own Claude plan (falls back if the PC is off) */
  aiEngine: z.enum(["openrouter", "claude"]),
  /** Gemini Live model for the voice assistant */
  voiceModel: z.string().max(60),
  /** speak voice replies out loud (needs a speaker on the Pi) */
  voiceReplies: z.boolean(),
  /** one of Gemini's prebuilt voices; the same voice for live chat and read-out answers */
  voiceName: z.string().regex(/^[A-Z][a-z]+$/).max(20),
  /** Gemini text-to-speech model for answers that weren't spoken live */
  ttsModel: z.string().max(60),
  /** e.g. "5th Year" — picks out the calendar events that matter */
  yearGroup: z.string().max(20),
  /** house name, e.g. "Grenville" (optional) */
  house: z.string().max(20),
  /** a few lines about the student, given to the assistant */
  profile: z.string().max(800),
  /** things the student is part of, e.g. "senior production" — pulls those dates in from the calendar */
  interests: z.array(z.string().max(40)).max(12),
  /** offer "send to Google Keep" on notes */
  googleKeep: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;

/** Which settings each role may change. Everything else is read-only for them. */
export const PARENT_SETTINGS: (keyof Settings)[] = [
  "parentName", "breakMins", "skipsPerDay", "maxTasksPerDay", "pointsStart", "pointsClaim",
  "blockList", "studyOnlySites", "blockApps", "focusAllow", "bedtime", "quietAfter11", "defaultMins",
];
export const OWNER_SETTINGS: (keyof Settings)[] = [
  "ownerName", "ai", "wakeWord", "iconKeys", "dimAtNight", "quietAfter11", "reminders", "brightness",
  "lieInWeekends", "leaveForSchool", "alarm", "location", "newsFeed", "nfcTags", "schoolPages",
  "schoolMail", "schoolMailSenders", "aiModel", "yearGroup", "house", "profile", "googleKeep", "interests",
  "voiceModel", "voiceReplies", "voiceName", "ttsModel", "aiEngine", "webSearch", "aiAdvisorModel", "buildModel", "aiBudgetUsd",
];

export const Device = z.object({
  id: z.string(),
  name: z.string(),
  role: Role,
  createdAt: z.number(),
  lastSeen: z.number().nullable(),
});
export type Device = z.infer<typeof Device>;

export const DayState = z.object({
  date: DateKey,
  kind: DayKind,
  /** computed from term dates before any manual mark */
  baseKind: DayKind,
  arrivedAt: z.number().nullable(),
  wokeAt: z.number().nullable(),
  sick: z.enum(["ill", "hurt", "flat"]).nullable(),
  skipsUsed: z.number().int(),
  lieIn: z.boolean(),
  /** week A / B of a two-week timetable (null outside term) */
  week: z.enum(["A", "B"]).nullable(),
});
export type DayState = z.infer<typeof DayState>;

export const Weather = z.object({
  icon: z.string(),
  temp: z.number(),
  rainAt: z.string().nullable(),
  fetchedAt: z.number(),
});
export type Weather = z.infer<typeof Weather>;

export const SchoolStatus = z.object({
  signedIn: z.boolean(),
  needsSignIn: z.boolean(),
  lastRun: z.number().nullable(),
  lastOk: z.number().nullable(),
  lastError: z.string().nullable(),
  running: z.boolean(),
  itemCount: z.number(),
});
export type SchoolStatus = z.infer<typeof SchoolStatus>;

/** Everything a screen needs in one fetch. Clients re-fetch it when the hub says something changed. */
/**
 * A tool the assistant built: a small web app (one HTML file, offline) that opens from the phone's
 * Tools tab and can be installed like an app. Served from its own origin, with no internet access.
 */
export const ToolTarget = z.enum(["phone", "school", "any"]);
export type ToolTarget = z.infer<typeof ToolTarget>;
export const ToolInfo = z.object({
  id: z.string(),
  title: z.string().max(60),
  description: z.string().max(300),
  icon: z.string().max(40),
  target: ToolTarget,
  jobId: z.string().nullable(),
  bytes: z.number(),
  version: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ToolInfo = z.infer<typeof ToolInfo>;

/** A big job the assistant does after a yes: building a tool, now or later. */
export const BuildWhere = z.enum(["pi", "computer"]);
export const BuildWhen = z.enum(["now", "later"]);
export const BuildRequest = z.object({
  title: z.string().min(2).max(60),
  brief: z.string().min(10).max(6000),
  target: ToolTarget,
  when: BuildWhen,
  where: BuildWhere,
  /** a tool to improve instead of starting from scratch */
  toolId: z.string().max(40).nullable(),
  /** files the student attached (stored on the hub until the job has used them) */
  attachments: z.array(z.object({ id: z.string(), name: z.string().max(120), mime: z.string().max(80) })).max(4),
});
export type BuildRequest = z.infer<typeof BuildRequest>;
export const Job = z.object({
  id: z.string(),
  kind: z.literal("build"),
  request: BuildRequest,
  status: z.enum(["queued", "running", "waiting", "done", "failed", "cancelled"]),
  /** what's happening, for the Tools tab */
  note: z.string().max(200),
  estUsd: z.number(),
  costUsd: z.number(),
  batchId: z.string().nullable(),
  toolId: z.string().nullable(),
  threadId: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Job = z.infer<typeof Job>;

export interface Snapshot {
  now: number;
  rev: number;
  role: Role;
  today: DayState;
  tomorrow: DayState;
  tasks: Task[];
  tomorrowTasks: Task[];
  bag: BagItem[];
  kit: string;
  session: Session | null;
  bank: number;
  lifetime: number;
  reward: Reward;
  nextReward: { name: string; goal: number; icon: string } | null;
  settings: Settings;
  timetable: { subject: string; span: number; start: string; end: string; room?: string; teacher?: string }[];
  /** registration / form time activity today, e.g. "PSHE" */
  formTime: string;
  /** school calendar dates in the next week */
  events: CalEvent[];
  /** weekly commitments on today (rehearsals, clubs) */
  activities: Activity[];
  /** tools the assistant built, newest first */
  tools: ToolInfo[];
  /** build jobs that aren't finished (or finished in the last day) */
  jobs: { id: string; title: string; status: Job["status"]; note: string; toolId: string | null; error: string | null; updatedAt: number }[];
  weather: Weather | null;
  news: string;
  birthday: { name: string; inDays: number } | null;
  heads: string;
  reminders: Reminder[];
  asks: Ask[];
  school: SchoolStatus;
  termLabel: string;
  sync: { lastSync: number };
}

/** Messages on the hub WebSocket. */
export type HubMessage =
  | { type: "hello"; rev: number; role: Role }
  | { type: "changed"; rev: number; topics: string[] }
  | { type: "input"; input: HwInput }
  | { type: "say"; icon: string; line: string; sub?: string; ms?: number }
  | { type: "leds"; frame: LedFrame }
  /** spoken reply audio for the speaker (16-bit mono PCM, base64) — hardware daemon only */
  | { type: "play"; pcm: string; rate: number }
  /** dev tools (only while switched on at the Pi): reload the wall */
  | { type: "dev"; action: "reload" };

/** Physical inputs from the GPIO daemon (or the simulator). */
export type HwInput =
  | { kind: "key"; key: 0 | 1 | 2 | 3; down: boolean }
  | { kind: "dial"; delta: 1 | -1 }
  | { kind: "dialPress" }
  | { kind: "touch" }
  | { kind: "nfc"; uid: string }
  | { kind: "mic"; on: boolean }
  | { kind: "power"; on: boolean }
  | { kind: "voice"; text: string };

/** 25 matrix cells + light bar as RGB hex with brightness 0..1. */
export interface LedFrame {
  cells: { c: string; o: number; anim: string }[];
  bar: { pct: number; on: number; lit: number };
  dialLed: number;
  touchRing: boolean;
}

/**
 * Big, expensive models Nudge never uses on OpenRouter (Claude-class, "pro" tiers). Heavy work goes
 * to Claude Code / Cowork on the computer instead, which runs on the student's own Claude plan.
 */
export const EXPENSIVE_MODEL = /(^anthropic\/|claude|opus|sonnet|fable|haiku|(^|\/)o\d(-pro)?$|gpt-5(\.\d+)?(-pro)?$|gpt-5[.\d]*-(pro|terra)|gemini-[\d.]+-pro|grok-\d(?!.*(fast|mini)))/i;
export const isExpensiveModel = (m: string) => !m.startsWith("@preset/") && EXPENSIVE_MODEL.test(m);

