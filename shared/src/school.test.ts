import { describe, expect, it } from "vitest";
import {
  calendarTags, CHURCHERS_2026_27, CHURCHERS_DAY, homeworkMins, homeworkSetOn, lessonTimes, matchTeacher, nextLesson,
  parseSchoolCalendar, parseStaffList, periodsFor, termInfo, weekLetter, type HomeworkPlan, type SchoolCtx, type Timetable,
} from "./index";

// A cut-down two-week timetable (maths: Wed + Thu in A, Tue + Wed + Thu in B).
const tt: Timetable = {
  A1: [{ subject: "eng", span: 2 }], A2: [{ subject: "re", span: 2 }], A3: [{ subject: "maths", span: 2 }],
  A4: [{ subject: "maths", span: 2 }], A5: [{ subject: "eng", span: 2 }],
  B1: [{ subject: "eng", span: 2 }], B2: [{ subject: "maths", span: 2 }], B3: [{ subject: "maths", span: 1 }],
  B4: [{ subject: "maths", span: 2 }], B5: [{ subject: "re", span: 2 }],
};
const ctx: SchoolCtx = {
  terms: CHURCHERS_2026_27,
  timetable: tt,
  isSchoolDay: (d) => termInfo(d, CHURCHERS_2026_27).kind === "school",
};
const plan: HomeworkPlan = { on: true, weeklyMinsPerSubject: 60, days: { A1: ["eng"], A4: ["maths"], B4: ["maths"], A2: ["re"], A5: ["re"] } };

describe("weeks A and B", () => {
  it("matches the school calendar, skipping half term", () => {
    expect(weekLetter("2026-09-09", CHURCHERS_2026_27)).toBe("A"); // week 1 (A) 7–13 Sep
    expect(weekLetter("2026-09-14", CHURCHERS_2026_27)).toBe("B");
    expect(weekLetter("2026-10-22", CHURCHERS_2026_27)).toBe("A"); // week 7 (A) 19–25 Oct
    expect(weekLetter("2026-10-28", CHURCHERS_2026_27)).toBe(null); // half term
    expect(weekLetter("2026-11-02", CHURCHERS_2026_27)).toBe("B"); // week 8 (B)
    expect(weekLetter("2026-12-07", CHURCHERS_2026_27)).toBe("A"); // week 13 (A)
    expect(weekLetter("2026-12-21", CHURCHERS_2026_27)).toBe(null);
  });

  it("picks the right day's lessons and bell times", () => {
    expect(periodsFor(tt, "B", 3)).toEqual([{ subject: "maths", span: 1 }]);
    expect(periodsFor({ "3": [{ subject: "art", span: 1 }] }, "A", 3)[0].subject).toBe("art");
    const l = lessonTimes([{ subject: "eng", span: 2 }, { subject: "drama", span: 2 }, { subject: "art", span: 1 }], CHURCHERS_DAY);
    expect(l.map((x) => `${x.start}-${x.end}`)).toEqual(["09:00-10:20", "10:40-12:00", "13:10-13:50"]);
  });
});

describe("homework", () => {
  it("maths set on Thursday is due Tuesday of week B, or Wednesday of week A", () => {
    expect(nextLesson("maths", "2026-09-10", ctx)).toBe("2026-09-15"); // Thu A → Tue B
    expect(nextLesson("maths", "2026-09-17", ctx)).toBe("2026-09-23"); // Thu B → Wed A
  });

  it("skips half term when finding the next lesson", () => {
    expect(nextLesson("eng", "2026-10-19", ctx)).toBe("2026-11-02"); // Mon A (19 Oct): Fri 23 is off → Mon B after half term
  });

  it("knows what's set when, and shares the weekly minutes", () => {
    expect(homeworkSetOn("2026-09-10", plan, CHURCHERS_2026_27)).toEqual(["maths"]);
    expect(homeworkSetOn("2026-09-14", plan, CHURCHERS_2026_27)).toEqual([]);
    expect(homeworkMins("eng", "A", plan)).toBe(60);
    expect(homeworkMins("re", "A", plan)).toBe(30);
  });
});

describe("teachers", () => {
  const staff = parseStaffList(`Nicola Clements
Teacher of Drama

Luci Selby
Teacher of Mathematics

Jon Seaton
Head of House Grenville and Teacher of Mathematics
Laura Snowball
Sports Science / PE / Design Technology
Ben Seal
Head of House Collingwood - Teacher of History/Economics/Games
Ben Skirving
Director of Sport/Head of Rugby
Nicola Clements
Teacher of Drama`);

  it("parses a pasted staff list and merges repeats", () => {
    expect(staff).toHaveLength(6);
    expect(staff[0]).toEqual({ name: "Nicola Clements", role: "Teacher of Drama" });
  });

  it("matches timetable codes, using the subject to break ties", () => {
    expect(matchTeacher("NEC", "drama", staff)?.name).toBe("Nicola Clements");
    expect(matchTeacher("LJS", "maths", staff)?.name).toBe("Luci Selby");
    expect(matchTeacher("BDS", "games", staff)?.name).toBe("Ben Seal");
    expect(matchTeacher("XYZ", "maths", staff)).toBe(null);
  });
});

describe("school calendar", () => {
  const who = { yearGroup: "5th Year", house: "" };
  it("keeps what matters to a 5th year", () => {
    expect(calendarTags("TERM COMMENCES", who)).toContain("term");
    expect(calendarTags("5th Year GCSE Art Mock Exam", who)).toEqual(expect.arrayContaining(["year", "exam", "creative"]));
    expect(calendarTags("5th YEAR PARENTS’ ACADEMIC INFORMATION EVENING WITH THE HEADMASTER (Donald Brooks Auditorium)", who)).toContain("parents");
    expect(calendarTags("GCSE & A Level Drama Theatre Trip to see ‘The Curious Incident’ (Woking Theatre)", who)).toContain("creative");
  });

  it("drops other years, staff meetings, fixtures and venues", () => {
    expect(calendarTags("4th Year GCSE Drama DNA Workshop by Quirky Bird Theatre Company (Studio 45)", who)).toBe(null);
    expect(calendarTags("PSHE Meeting for 1st-5th Year Form Tutors (Lecture Theatre)", who)).toBe(null);
    expect(calendarTags("Girls’ Hockey v Charterhouse U14A, U14B (A)", who)).toBe(null);
    expect(calendarTags("CCALS Lecture: ‘Allies at War’ (Lecture Theatre)", who)).toBe(null);
    expect(calendarTags("U6th PARENTS’ EVENING (New College)", who)).toBe(null);
  });

  it("reads dated lines and week letters from the calendar text", () => {
    const text = [
      " | WEEK 7 (A) | 19 OCT - 25 OCT",
      "Wed 21",
      " | 09:00 | 5th Year GCSE Drama DNA Workshop by Quirky Bird Theatre",
      " | Company (Studio 45)",
      "Sun 1 | HALF TERM",
      "=== PAGE 2",
      " | WEEK 8 (B) | 02 NOV - 08 NOV",
      "Tues 3",
      " | 08:35 | 5th Year House Quiz (Sports Hall)",
    ].join("\n");
    const { lines, weeks } = parseSchoolCalendar(text);
    expect(weeks).toEqual([{ monday: expect.stringMatching(/-10-19$/), letter: "A" }, { monday: expect.stringMatching(/-11-02$/), letter: "B" }]);
    expect(lines[0]).toMatchObject({ date: expect.stringMatching(/-10-21$/), time: "09:00", title: "5th Year GCSE Drama DNA Workshop by Quirky Bird Theatre Company (Studio 45)" });
    expect(lines[1].date).toMatch(/-11-01$/);
    expect(lines[2]).toMatchObject({ date: expect.stringMatching(/-11-03$/), time: "08:35" });
  });
});
