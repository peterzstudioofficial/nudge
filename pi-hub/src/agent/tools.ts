import { z } from "zod";

/**
 * One tool, usable by both assistants (OpenRouter text, Gemini Live voice).
 * `kind` says what it may do: "read" tools answer questions, "ask" tools only create a request
 * that waits for the student's OK. Nothing a model calls can send, buy or change anything
 * directly.
 */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: "read" | "save" | "ask";
  run(args: unknown): Promise<string>;
}

export function tool<S extends z.ZodType>(
  name: string,
  description: string,
  schema: S,
  kind: Tool["kind"],
  run: (args: z.infer<S>) => Promise<string>,
): Tool {
  const parameters = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete parameters.$schema;
  return {
    name,
    description,
    parameters,
    kind,
    async run(args) {
      const parsed = schema.safeParse(args ?? {});
      if (!parsed.success) return `error: bad arguments — ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300)}`;
      return run(parsed.data);
    },
  };
}

/** Parse a model's tool-call arguments; never throws. */
export function parseArgs(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __invalid_json: raw.slice(0, 200) };
  }
}
