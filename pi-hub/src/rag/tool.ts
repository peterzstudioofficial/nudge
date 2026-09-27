import { z } from "zod";
import { tool, type Tool } from "../agent/tools";
import type { PersonalIndex } from "./index";

export function searchTool(index: PersonalIndex): Tool {
  return tool(
    "search_my_stuff",
    "Search the student's own things stored on the wall: notes and voice-note transcripts, school emails and pages, the school calendar, tasks and homework, weekly commitments (rehearsals), birthdays and teachers. Use it for anything about what they wrote, were told or have coming up.",
    z.object({ query: z.string().min(1).max(200).describe("what to look for, in plain words") }),
    "read",
    async ({ query }) => JSON.stringify(await index.search(query, 8)),
  );
}
