/**
 * The OpenRouter APIs the tool builder uses, beyond chat:
 * - Files (beta): attachments are uploaded, used by one job, then deleted.
 * - Responses + the `openrouter:bash` server tool: a sandboxed container (no internet) where the
 *   model writes the app and tests it. Files it made are read back with the Containers API.
 * - Batch: jobs for later run at half price, usually within minutes, at most 24 hours.
 */
const BASE = "https://openrouter.ai/api/v1";

export class OrError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

export interface OrClient {
  uploadFile(name: string, mime: string, data: Uint8Array): Promise<string>;
  deleteFile(id: string): Promise<void>;
  responses(body: Record<string, unknown>, signal?: AbortSignal): Promise<ResponsesResult>;
  containerFiles(containerId: string): Promise<{ id: string; path: string; bytes: number }[]>;
  containerFile(containerId: string, fileId: string): Promise<Uint8Array>;
  createBatch(body: Record<string, unknown>): Promise<{ id: string; status: string }>;
  getBatch(id: string): Promise<BatchResult>;
}

export interface ResponsesResult {
  text: string;
  cost: number;
  containerIds: string[];
  /** files the sandbox commands created or changed (from file citations) */
  files: { containerId: string; fileId: string; filename: string }[];
  commands: number;
}

export interface BatchResult {
  status: "validating" | "in_progress" | "finalizing" | "completed" | "failed" | "expired" | string;
  error: string | null;
  /** first result's message text, once completed */
  text: string | null;
  cost: number;
}

export function orClient(key: () => string | null, fetchImpl: typeof fetch = fetch): OrClient {
  const call = async (method: string, path: string, body?: BodyInit | Record<string, unknown>, signal?: AbortSignal): Promise<Response> => {
    const k = key();
    if (!k) throw new OrError("no OpenRouter key on the hub", 401);
    const isJson = body && !(body instanceof FormData) && typeof body === "object" && !(body instanceof Uint8Array);
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${k}`, "x-title": "Nudge", ...(isJson ? { "content-type": "application/json" } : {}) },
      body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
      signal: signal ?? AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new OrError(`OpenRouter ${path.split("/")[1]}: ${(j.error?.message ?? `HTTP ${res.status}`).slice(0, 160)}`, res.status);
    }
    return res;
  };

  return {
    async uploadFile(name, mime, data) {
      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(data)], { type: mime }), name);
      const j = (await (await call("POST", "/files", fd)).json()) as { id?: string };
      if (!j.id) throw new OrError("upload gave no file id");
      return j.id;
    },
    async deleteFile(id) {
      await call("DELETE", `/files/${encodeURIComponent(id)}`).catch(() => {});
    },
    async responses(body, signal) {
      const j = (await (await call("POST", "/responses", body, signal ?? AbortSignal.timeout(15 * 60_000))).json()) as {
        output?: {
          type?: string;
          content?: { type?: string; text?: string }[];
          container_id?: string;
          files?: { container_id?: string; file_id?: string; filename?: string }[];
        }[];
        output_text?: string;
        usage?: { cost?: number };
      };
      const out = j.output ?? [];
      const texts = out.filter((o) => o.type === "message").flatMap((o) => (o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? ""));
      const bash = out.filter((o) => o.type === "openrouter:bash" || o.type === "openrouter:shell");
      return {
        text: (j.output_text ?? texts.join("\n")).trim(),
        cost: j.usage?.cost ?? 0,
        containerIds: [...new Set(bash.map((b) => b.container_id).filter((x): x is string => !!x))],
        files: bash.flatMap((b) => (b.files ?? []).filter((f) => f.container_id && f.file_id).map((f) => ({ containerId: f.container_id!, fileId: f.file_id!, filename: f.filename ?? "" }))),
        commands: bash.length,
      };
    },
    async containerFiles(containerId) {
      const all: { id: string; path: string; bytes: number }[] = [];
      let after: string | null = null;
      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({ limit: "100", ...(after ? { after } : {}) });
        const j = (await (await call("GET", `/containers/${encodeURIComponent(containerId)}/files?${q}`)).json()) as {
          data?: { id: string; path: string; bytes: number }[];
          has_more?: boolean;
          last_id?: string | null;
        };
        all.push(...(j.data ?? []));
        if (!j.has_more || !j.last_id) break;
        after = j.last_id;
      }
      return all;
    },
    async containerFile(containerId, fileId) {
      const r = await call("GET", `/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(fileId)}/content`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async createBatch(body) {
      const j = (await (await call("POST", "/batches", body)).json()) as { id?: string; status?: string };
      if (!j.id) throw new OrError("batch gave no id");
      return { id: j.id, status: j.status ?? "validating" };
    },
    async getBatch(id) {
      const j = (await (await call("GET", `/batches/${encodeURIComponent(id)}`)).json()) as {
        status?: string;
        error?: { message?: string } | null;
        usage?: { cost?: number; total_cost?: number } | null;
        results?: { error?: { message?: string } | null; response?: Record<string, unknown> | null }[] | null;
      };
      const first = j.results?.[0];
      const resp = (first?.response ?? null) as { body?: unknown; choices?: { message?: { content?: string } }[]; usage?: { cost?: number } } | null;
      const chat = (resp && "choices" in resp ? resp : (resp?.body as typeof resp)) ?? null;
      return {
        status: j.status ?? "unknown",
        error: j.error?.message ?? first?.error?.message ?? null,
        text: chat?.choices?.[0]?.message?.content ?? null,
        cost: j.usage?.cost ?? j.usage?.total_cost ?? chat?.usage?.cost ?? 0,
      };
    },
  };
}
