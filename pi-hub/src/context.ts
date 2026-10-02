import type { AgentThread } from "@nudge/shared";
import type { Tool } from "./agent/tools";
import type { PersonalIndex } from "./rag/index";
import type { AppsService } from "./agent/composio";
import type { VoiceService } from "./voice/wall";
import type { Stt } from "./voice/stt";
import type { Keys } from "./keys";
import type { BuilderService } from "./builder/builder";
import type { Auth } from "./auth";
import type { Config } from "./config";
import type { Hub } from "./hub";
import type { Weather, SchoolStatus, HwInput, LedFrame } from "@nudge/shared";

export interface WeatherService {
  current(): Weather | null;
  refresh(): Promise<void>;
}
export interface NewsService {
  headline(): string;
  refresh(): Promise<void>;
}
export interface SchoolService {
  status(): SchoolStatus;
  refresh(reason: string): Promise<void>;
  setSession(cookies: unknown[], userAgent: string | null): Promise<void>;
  clearSession(): Promise<void>;
}
export interface AgentService {
  available(): boolean;
  run(input: { prompt: string; mode: "ask" | "act" | "watch"; origin: "desktop" | "wall" | "app" }): string;
  stop(threadId: string): void;
  /** Set up one spoken turn for the voice assistant (Gemini Live) with the same tools and rules. */
  voiceTurn?(): Promise<{
    thread: AgentThread;
    system: string;
    context: string;
    tools: Tool[];
    finish(heard: string, text: string): void;
    fail(msg: string): void;
  }>;
  /** The assistant's tools, for Claude on Peter's computer (the Nudge connector). Same rules. */
  toolList?(): Promise<{ name: string; description: string; parameters: Record<string, unknown> }[]>;
  callTool?(name: string, args: unknown, threadId?: string | null): Promise<string>;
  /** A short title and tags for a transcribed voice note (structured output). */
  tidyNote?(text: string): Promise<{ label: string; tags: string[] } | null>;
}
export interface HwBridge {
  /** input from the GPIO daemon → the wall screen */
  input(i: HwInput): void;
  /** LED frame from the wall screen → the GPIO daemon */
  leds(f: LedFrame): void;
}

export interface Ctx {
  cfg: Config;
  hub: Hub;
  /** reads scanned documents and photos (OpenRouter), when a key is set */
  ocr?: import("./rag/library").Ocr | null;
  auth: Auth;
  weather: WeatherService;
  news: NewsService;
  school: SchoolService;
  agent: AgentService;
  /** connected apps (Composio); optional so tests can leave it out */
  apps?: AppsService;
  /** private search over the wall's own data */
  index?: PersonalIndex;
  /** the wall's voice assistant (mic stream from the hardware daemon) */
  voice?: VoiceService;
  /** builds tools (small apps) after a yes */
  builder?: BuilderService;
  /** the OpenRouter key (hub.env, or connected from setup) */
  keys?: Keys;
  /** on-device speech-to-text, once its model has loaded */
  stt?: () => Stt | null;
  hw: HwBridge;
}
