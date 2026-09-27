/**
 * OpenRouter chat client (OpenAI-compatible API).
 *
 * Every request is pinned to zero-data-retention endpoints that don't collect data
 * (`provider.zdr` + `provider.data_collection: "deny"`), sorted by throughput so answers come
 * back fast, with a fallback model if the first has no such endpoint free right now.
 */

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
export const FALLBACK_MODELS = ["z-ai/glm-5.3-flash"];
const URL_ = "https://openrouter.ai/api/v1/chat/completions";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  finish: string;
  model: string;
  cost: number;
}

export class LlmError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

export interface Llm {
  chat(o: { messages: Message[]; tools?: ToolSpec[]; maxTokens?: number; model?: string; signal?: AbortSignal }): Promise<ChatResult>;
}

export function openRouter(apiKey: string, opts: { onCost?: (usd: number) => void; fetchImpl?: typeof fetch } = {}): Llm {
  const f = opts.fetchImpl ?? fetch;
  return {
    async chat({ messages, tools, maxTokens = 1200, model = DEFAULT_MODEL, signal }) {
      const body = {
        model,
        models: [model, ...FALLBACK_MODELS.filter((m) => m !== model)],
        messages,
        ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
        max_tokens: maxTokens,
        temperature: 0.3,
        provider: {
          zdr: true,
          data_collection: "deny",
          require_parameters: true,
          sort: "throughput",
        },
        usage: { include: true },
      };
      let res: Response;
      try {
        res = await f(URL_, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "x-title": "Nudge",
          },
          body: JSON.stringify(body),
          signal: signal ?? AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        throw new LlmError("can't reach OpenRouter — offline?");
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
        model?: string;
        choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
        usage?: { cost?: number };
      };
      if (!res.ok || json.error) {
        const m = json.error?.message ?? `HTTP ${res.status}`;
        if (res.status === 401) throw new LlmError("the OpenRouter key was rejected", 401);
        if (res.status === 402) throw new LlmError("OpenRouter credit has run out", 402);
        if (res.status === 429) throw new LlmError("too many requests, try again in a minute", 429);
        if (/data policy|zdr|no endpoints/i.test(m)) throw new LlmError("no zero-retention provider free for that model right now", res.status);
        throw new LlmError(`OpenRouter: ${m.slice(0, 120)}`, res.status);
      }
      const choice = json.choices?.[0];
      const cost = json.usage?.cost ?? 0;
      if (cost) opts.onCost?.(cost);
      return {
        content: (choice?.message?.content ?? "").trim(),
        toolCalls: choice?.message?.tool_calls ?? [],
        finish: choice?.finish_reason ?? "stop",
        model: json.model ?? model,
        cost,
      };
    },
  };
}
