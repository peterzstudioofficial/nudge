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
 *
 * Routing: requests with tools are left to Auto Exacto (OpenRouter's default for tool calls: it
 * ranks providers by tool-calling success and speed); plain requests go fastest-first. Router
 * metadata is switched on so the Pi's log shows which provider answered.
 *
 * Deliberately not used: response caching (it would keep answers on OpenRouter for minutes),
 * `:free` models (their providers may log prompts), service tiers (the zero-retention providers
 * for these models don't offer them) and input/output logging (keep it off in the dashboard).
 */

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
export const FALLBACK_MODELS = ["z-ai/glm-5.3-flash"];
/** A stronger model the cheap one may consult on hard questions (openrouter:advisor). */
export const DEFAULT_ADVISOR = "deepseek/deepseek-v4-pro";
const URL_ = "https://openrouter.ai/api/v1/chat/completions";
/**
 * USD per million tokens. Above the cheap models Nudge uses, far below Claude-class ones, so no
 * request (or fallback) can ever land on an expensive model or endpoint.
 */
const MAX_PRICE = { prompt: "0.5", completion: "1.5" };

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

/** The key can change while the hub runs (connected from the setup page), so it's read per call. */
export function openRouter(
  apiKey: string | (() => string | null),
  opts: { onCost?: (usd: number) => void; onRoute?: (summary: string) => void; fetchImpl?: typeof fetch } = {},
): Llm {
  const f = opts.fetchImpl ?? fetch;
  const key = () => (typeof apiKey === "function" ? apiKey() : apiKey);
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
        // With tools, leave the order to Auto Exacto; without, fastest first.
        ...(allTools.length ? {} : { sort: "throughput" }),
        max_price: MAX_PRICE,
      },
      usage: { include: true },
    };
    const k = key();
    if (!k) throw new LlmError("no OpenRouter key on the hub", 401);
    let res: Response;
    try {
      res = await f(URL_, {
        method: "POST",
        headers: {
          authorization: `Bearer ${k}`,
          "content-type": "application/json",
          // Shows as "Nudge" in your own OpenRouter activity. No HTTP-Referer, so the app isn't
          // listed publicly.
          "x-title": "Nudge",
          "x-openrouter-metadata": "enabled",
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
      openrouter_metadata?: { summary?: string };
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
    if (out.openrouter_metadata?.summary) opts.onRoute?.(out.openrouter_metadata.summary.slice(0, 200));
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

/** The key's own limits and what's been used (GET /api/v1/key). Free to call. */
export async function openRouterKeyInfo(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ usage: number; limit: number | null; remaining: number | null; label: string } | null> {
  try {
    const r = await fetchImpl("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const d = ((await r.json()) as { data?: { usage?: number; limit?: number | null; limit_remaining?: number | null; label?: string } }).data;
    return d ? { usage: d.usage ?? 0, limit: d.limit ?? null, remaining: d.limit_remaining ?? null, label: d.label ?? "" } : null;
  } catch {
    return null;
  }
}

/** OAuth PKCE: swap the code OpenRouter sent back for a key. */
export async function openRouterExchange(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await fetchImpl("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { key?: string; error?: { message?: string } };
  if (!r.ok || !j.key) throw new LlmError(`OpenRouter didn't give a key (${j.error?.message ?? r.status})`, r.status);
  return j.key;
}
