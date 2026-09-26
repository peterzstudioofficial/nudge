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
  auth: Auth;
  weather: WeatherService;
  news: NewsService;
  school: SchoolService;
  agent: AgentService;
  hw: HwBridge;
}
