import { contextBridge, ipcRenderer } from "electron";

/** The only thing the desktop windows can reach: a few named calls, no Node, no raw IPC. */
const CHANNELS = ["snapshot", "online", "nudge", "sign", "bedtime", "agent-changed"] as const;

contextBridge.exposeInMainWorld("nudge", {
  state: () => ipcRenderer.invoke("state"),
  hub: (method: string, path: string, body?: unknown) => ipcRenderer.invoke("hub", method, path, body),
  pair: (hub: string, code: string, name: string) => ipcRenderer.invoke("pair", hub, code, name),
  signIn: () => ipcRenderer.invoke("signin"),
  win: (action: "min" | "max" | "close" | "hide") => ipcRenderer.invoke("win", action),
  open: (what: "agent" | "notes" | "tasks") => ipcRenderer.invoke("open", what),
  snoozeBedtime: () => ipcRenderer.invoke("snooze-bedtime"),
  copy: (text: string) => ipcRenderer.invoke("copy", text),
  on: (channel: (typeof CHANNELS)[number], cb: (data: unknown) => void) => {
    if (!CHANNELS.includes(channel)) return () => {};
    const fn = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
