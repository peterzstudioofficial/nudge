import { addDays, type SchoolAction, type SchoolItem, type Task } from "@nudge/shared";
import type { z } from "zod";
import { HttpError } from "../errors";
import type { Hub } from "../hub";

/**
 * Turning a school email / page item into something on the wall. Every action is local to
 * the hub (nothing is sent back to school), and every action can be undone once.
 */
export function schoolAction(hub: Hub, id: string, a: z.infer<typeof SchoolAction>): { item: SchoolItem; created: string | null } {
  const item = hub.school.get(id);
  if (!item) throw new HttpError(404, "no such item");
  const today = hub.todayKey();

  if (a.type === "undo") {
    const undo = hub.db.kvGet<{ kind: string; id: string } | null>("schoolUndo:" + id, null);
    if (undo) {
      if (undo.kind === "task") hub.deleteTask(undo.id);
      if (undo.kind === "taskUpdate") {
        const prev = hub.db.kvGet<Task | null>("schoolRestore:" + id, null);
        if (prev) hub.tasks.put(prev);
        hub.db.kvDel("schoolRestore:" + id);
        hub.bus.changed("tasks");
      }
      if (undo.kind === "bag") hub.bagRemove(undo.id);
      if (undo.kind === "note") hub.deleteNote(undo.id);
      if (undo.kind === "reminder") hub.reminders.del(undo.id);
      hub.db.kvDel("schoolUndo:" + id);
    }
    const back = hub.school.put({ ...item, handled: false, action: null });
    hub.bus.changed("school");
    return { item: back, created: null };
  }

  if (item.handled && a.type !== "dismiss") throw new HttpError(409, "already done — undo it first");

  let created: { kind: string; id: string } | null = null;
  const name = (a.name || item.title).slice(0, 80);
  switch (a.type) {
    case "task": {
      // Homework the timetable already expected: fill in the real details instead of adding a second task.
      const expected = item.subject
        ? hub.tasks.all().find((t) => t.expected && !t.done && t.subject === item.subject && t.date >= addDays(today, -3) && (!item.due || !t.due || Math.abs(Date.parse(t.due) - Date.parse(item.due)) <= 3 * 86_400_000))
        : undefined;
      if (expected) {
        hub.db.kvSet("schoolRestore:" + id, expected);
        const t = hub.tasks.put({ ...expected, expected: false, name, due: item.due ?? expected.due ?? null, note: (item.from ? `from ${item.from}` : expected.note).slice(0, 200), mins: a.mins ?? expected.mins, updatedAt: Date.now() });
        hub.bus.changed("tasks");
        created = { kind: "taskUpdate", id: t.id };
        break;
      }
      const date = a.date ?? (item.due && item.due > today ? addDays(item.due, -1) : today);
      const t = hub.addTask(
        { date: date < today ? today : date, name, subject: item.subject ?? "study", phase: "home", mins: a.mins ?? hub.settings().defaultMins, note: item.from ? `from ${item.from}` : "", when: "date" },
        "school",
        { skipCap: true },
      );
      created = { kind: "task", id: t.id };
      break;
    }
    case "bag": {
      const date = a.date ?? (item.due && item.due >= today ? item.due : hub.bagTarget());
      const b = hub.addBag({ date, name: name.replace(/^bring (your |a |the )?/i, ""), subject: item.subject ?? "mine", note: item.from ? item.from.toLowerCase() : "", kept: false }, "school");
      created = { kind: "bag", id: b.id };
      break;
    }
    case "remind": {
      const at = a.date ? new Date(a.date + "T16:10:00").getTime() : Date.now() + 60 * 60_000;
      const r = hub.addReminder(name, item.preview.slice(0, 200), at, "school");
      created = { kind: "reminder", id: r.id };
      break;
    }
    case "note": {
      const n = hub.addNote({ kind: "note", label: name, body: `${item.preview}\n\n${item.from ? "From " + item.from + ". " : ""}${item.url}`, tags: ["school"], secs: 0 });
      created = { kind: "note", id: n.id };
      break;
    }
    case "dismiss":
      break;
  }
  if (created) hub.db.kvSet("schoolUndo:" + id, created);
  const next = hub.school.put({ ...item, handled: true, action: a.type });
  hub.feed("school", a.type === "dismiss" ? `Dismissed "${item.title}"` : `School: ${item.title} → ${a.type}`);
  hub.bus.changed("school");
  return { item: next, created: created?.id ?? null };
}
