import { addDays, dateKey } from "@nudge/shared";
import { type Hub, newId } from "./hub";

/** Dev / demo data, straight from the designs, so every screen has something real to show. */
export function seedDemo(hub: Hub): void {
  if (hub.db.kvGet<boolean>("seeded", false)) return;
  hub.db.kvSet("seeded", true);
  const today = hub.todayKey();
  const now = hub.now();
  const t = (name: string, subject: string, phase: "home" | "study" | "mine" | "bag", mins: number) =>
    hub.addTask({ date: today, name, subject, phase, mins, note: "", when: "date" }, "parent", { skipCap: true });
  t("quadratics", "maths", "home", 25);
  t("atoms q1-8", "chem", "home", 25);
  t("essay plan", "eng", "home", 25);
  t("revision one", "study", "study", 25);
  t("revision two", "study", "study", 25);
  t("guitar", "mine", "mine", 20);
  t("tidy desk", "mine", "mine", 10);
  t("pack bag", "bag", "bag", 5);

  const tomorrow = addDays(today, 1);
  hub.addTask({ date: tomorrow, name: "chemistry q1-8", subject: "chem", phase: "home", mins: 25, note: "", when: "date" }, "parent", { skipCap: true });
  hub.addTemplate({ name: "revision, one hour", subject: "study", phase: "study", mins: 60, days: [1, 2, 3, 4], schoolDaysOnly: true });

  // 24 points banked so far this month
  for (let i = 0; i < 8; i++) {
    hub.points.put({ id: newId(), ts: now - (i + 1) * 86_400_000, delta: 3, reason: "claim", taskId: null });
  }
  const target = hub.bagTarget();
  const bag = hub.bagFor(target);
  const chem = bag.find((b) => b.subject === "chem");
  if (chem) hub.bag.put({ ...chem, note: "green, not blue" });
  const eng = bag.find((b) => b.subject === "eng");
  if (eng) hub.bag.put({ ...eng, name: "english lit", note: "act 3 notes" });

  const mm = String(new Date(addDays(today, 3)).getMonth() + 1).padStart(2, "0");
  const dd = addDays(today, 3).slice(8);
  hub.setBirthdays([{ name: "mum", date: `${mm}-${dd}` }]);

  const feed: [string, number][] = [
    ["Packed bag for tomorrow", 22],
    ["Asked the agent for a deadline", 21],
    ["Claimed chemistry q1-8", 1],
  ];
  for (const [text, hoursAgo] of feed) hub.feedC.put({ id: newId(), ts: now - hoursAgo * 3600_000, type: "demo", text });

  const notes: [("note" | "voice" | "task"), string, string, number][] = [
    ["note", "song idea, second verse", "Something about the walk home in the rain\nSlower than the first verse\nTry it in D", 0],
    ["voice", "riff", "Hummed into the wall on the way past", 14],
    ["note", "ask Mr Hale about the mock", "Whether the practical counts toward the final grade", 0],
    ["task", "restring the guitar", "Two strings gone\nShop shuts at five on Saturdays", 0],
    ["note", "revision order for chem", "Bonding first\nThen rates\nEquilibrium last, it needs the other two", 0],
    ["note", "birthday, mum", "Something for the garden\nAsk Dad what she already has", 0],
    ["note", "kit list for Thursday", "Indoor kit\nNot the studs", 0],
  ];
  notes.forEach(([kind, label, body, secs], i) => {
    const n = hub.addNote({ kind, label, body, tags: [], secs });
    hub.notes.put({ ...n, createdAt: now - i * 5 * 3600_000, updatedAt: now - i * 5 * 3600_000 });
  });
  void dateKey;
}
