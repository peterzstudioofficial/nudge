/**
 * OpenRouter chat client (OpenAI-compatible API).
 *
 * Every request is pinned to zero-data-retention endpoints that don't collect data
 * (`provider.zdr` + `provider.data_collection: "deny"`), sorted by throughput so answers come
 * back fast, with a fallback model if the first has no such endpoint free right now, and a
 * price ceiling so a fallback can never land on an expensive endpoint.
 *
 * Free extras used on every request:
 * - `session_id`: sticky routing, so each turn of one question hits the same provider's prompt
 *   cache (cached input is ~30× cheaper and faster).
 * - `context-compression` plugin: squeezes the middle of an over-long conversation instead of
 *   failing.
 * - Several tool calls in one turn are allowed (the default), and the hub runs read tools in parallel.
 *
 * OpenRouter server tools (web search, web fetch, datetime, advisor) run on OpenRouter's side
 * inside the same request; `stop_server_tools_when` caps their steps and spend.
 */

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
export const FALLBACK_MODELS = ["z-ai/glm-5.3-flash"];
/** A stronger model the cheap one may consult on hard questions (openrouter:advisor). */
export const DEFAULT_ADVISOR = "deepseek/deepseek-v4-pro";
const URL_ = "https://openrouter.ai/api/v1/chat/completions";
/** USD per million tokens. Well above the models we use; stops a fallback to a pricey endpoint. */
const MAX_PRICE = { prompt: "1", completion: "2" };

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

/** A tool OpenRouter runs itself, e.g. { type: "openrouter:web_search", parameters: {...} }. */
export interface ServerTool {
  type: `openrouter:${string}`;
  parameters?: Record<string, unknown>;
}

export interface Citation {
  url: string;
  title: string;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  finish: string;
  model: string;
  cost: number;
  /** web pages the answer is based on (from web search / fetch) */
  citations: Citation[];
  /** server tool calls OpenRouter ran for this answer */
  serverToolCalls: number;
}

export class LlmError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

export interface ChatOptions {
  messages: Message[];
  tools?: ToolSpec[];
  serverTools?: ServerTool[];
  maxTokens?: number;
  model?: string;
  signal?: AbortSignal;
  /** groups the turns of one question: same provider, warm prompt cache */
  sessionId?: string;
  /** how hard reasoning models think; "low" keeps wall answers quick */
  effort?: "none" | "minimal" | "low" | "medium" | "high";
  /** hard cap on what server tools may spend in this request */
  maxToolCostUsd?: number;
  /** JSON Schema for a structured answer (response-healing repairs broken JSON for free) */
  json?: { name: string; schema: Record<string, unknown> };
}

export interface Llm {
  chat(o: ChatOptions): Promise<ChatResult>;
}

export function openRouter(apiKey: string, opts: { onCost?: (usd: number) => void; fetchImpl?: typeof fetch } = {}): Llm {
  const f = opts.fetchImpl ?? fetch;
  const llm: Llm = {
    async chat(o) {
      try {
        return await once(o);
      } catch (e) {
        // `require_parameters` means every endpoint must support every parameter; if the only
        // zero-retention endpoints don't take a reasoning hint, ask again without it.
        if (o.effort && e instanceof LlmError && /no zero-retention/.test(e.message)) return once({ ...o, effort: undefined });
        throw e;
      }
    },
  };
  return llm;

  async function once({ messages, tools, serverTools, maxTokens = 1200, model = DEFAULT_MODEL, signal, sessionId, effort, maxToolCostUsd = 0.03, json }: ChatOptions): Promise<ChatResult> {
    const allTools = [...(tools ?? []), ...(serverTools ?? [])];
    const plugins: Record<string, unknown>[] = [{ id: "context-compression", engine: "middle-out" }];
    if (json) plugins.push({ id: "response-healing" });
    const body = {
      model,
      models: [model, ...FALLBACK_MODELS.filter((m) => m !== model)],
      messages,
      ...(allTools.length ? { tools: allTools, tool_choice: "auto" } : {}),
      ...(serverTools?.length
        ? { stop_server_tools_when: [{ type: "step_count_is", step_count: 6 }, { type: "max_cost", max_cost_in_dollars: maxToolCostUsd }] }
        : {}),
      ...(json ? { response_format: { type: "json_schema", json_schema: { name: json.name, schema: json.schema, strict: true } } } : {}),
      ...(effort ? { reasoning: { effort } } : {}),
      ...(sessionId ? { session_id: sessionId.slice(0, 256) } : {}),
      plugins,
      max_tokens: maxTokens,
      temperature: 0.3,
      provider: {
        zdr: true,
        data_collection: "deny",
        require_parameters: true,
        sort: "throughput",
        max_price: MAX_PRICE,
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
        signal: signal ?? AbortSignal.timeout(90_000),
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new LlmError("can't reach OpenRouter — offline?");
    }
    const out = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
      model?: string;
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: ToolCall[];
          annotations?: { type?: string; url_citation?: { url?: string; title?: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: { cost?: number; server_tool_use_details?: { tool_calls_executed?: number } };
    };
    if (!res.ok || out.error) {
      const m = out.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 401) throw new LlmError("the OpenRouter key was rejected", 401);
      if (res.status === 402) throw new LlmError("OpenRouter credit has run out", 402);
      if (res.status === 429) throw new LlmError("too many requests, try again in a minute", 429);
      if (/data policy|zdr|no endpoints|max_price|price/i.test(m)) throw new LlmError("no zero-retention provider free for that model right now", res.status);
      throw new LlmError(`OpenRouter: ${m.slice(0, 120)}`, res.status);
    }
    const choice = out.choices?.[0];
    const cost = out.usage?.cost ?? 0;
    if (cost) opts.onCost?.(cost);
    const seen = new Set<string>();
    const citations: Citation[] = [];
    for (const a of choice?.message?.annotations ?? []) {
      const u = a.url_citation?.url;
      if (a.type !== "url_citation" || !u || seen.has(u) || !/^https?:\/\//.test(u)) continue;
      seen.add(u);
      citations.push({ url: u, title: (a.url_citation?.title || new URL(u).hostname).slice(0, 120) });
    }
    return {
      content: (choice?.message?.content ?? "").trim(),
      // Only our own function tools come back to us; server tools already ran.
      toolCalls: (choice?.message?.tool_calls ?? []).filter((c) => !c.function?.name?.startsWith("openrouter:")),
      finish: choice?.finish_reason ?? "stop",
      model: out.model ?? model,
      cost,
      citations: citations.slice(0, 6),
      serverToolCalls: out.usage?.server_tool_use_details?.tool_calls_executed ?? 0,
    };
  }
}

/** The server tools the assistant gets, from the owner's settings. */
export function serverToolsFor(s: { webSearch: boolean; aiAdvisorModel: string; blockList: string[] }, o: { wall: boolean }): ServerTool[] {
  const list: ServerTool[] = [{ type: "openrouter:datetime", parameters: { timezone: "Europe/London" } }];
  if (s.webSearch) {
    // Sites a parent blocked stay blocked for the assistant too.
    const blocked = s.blockList.map((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((d) => /\./.test(d)).slice(0, 50);
    list.push(
      {
        type: "openrouter:web_search",
        parameters: {
          // Parallel "turbo": the cheapest, fastest engine (~$0.001 a search).
          engine: "parallel",
          mode: "turbo",
          max_results: 5,
          max_uses: o.wall ? 1 : 3,
          max_total_results: 15,
          user_location: { type: "approximate", country: "GB", timezone: "Europe/London" },
          ...(blocked.length ? { excluded_domains: blocked } : {}),
        },
      },
      {
        type: "openrouter:web_fetch",
        parameters: {
          // Fetched directly by OpenRouter: no extra third party sees the page request.
          engine: "openrouter",
          max_uses: o.wall ? 1 : 3,
          max_content_tokens: 6000,
          ...(blocked.length ? { blocked_domains: blocked } : {}),
        },
      },
    );
  }
  if (s.aiAdvisorModel && !o.wall) {
    list.push({
      type: "openrouter:advisor",
      parameters: {
        name: "tutor",
        model: s.aiAdvisorModel,
        instructions:
          "You're advising a fast assistant that helps a UK GCSE student. Give a correct, concise explanation or plan it can pass on. No personal opinions, no lecturing.",
        forward_transcript: false,
        max_completion_tokens: 1500,
        reasoning: { effort: "medium" },
      },
    });
  }
  return list;
}
