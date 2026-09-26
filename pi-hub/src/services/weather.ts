import type { Weather } from "@nudge/shared";
import type { Hub } from "../hub";
import type { WeatherService } from "../context";

/** Open-Meteo: free, no key, no account. One small request an hour. */
const CODE_ICON: [number[], string][] = [
  [[0], "wb_sunny"],
  [[1, 2], "partly_cloudy_day"],
  [[3], "cloud"],
  [[45, 48], "foggy"],
  [[51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], "rainy"],
  [[71, 73, 75, 77, 85, 86], "weather_snowy"],
  [[95, 96, 99], "thunderstorm"],
];

export function weatherService(hub: Hub, offline: boolean): WeatherService {
  return {
    current() {
      return hub.db.kvGet<Weather | null>("weather", null);
    },
    async refresh() {
      if (offline) return;
      const { lat, lon } = hub.settings().location;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=precipitation_probability&forecast_days=1&timezone=Europe%2FLondon`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const j = (await res.json()) as {
          current: { temperature_2m: number; weather_code: number };
          hourly: { time: string[]; precipitation_probability: number[] };
        };
        const code = j.current.weather_code;
        const icon = CODE_ICON.find(([codes]) => codes.includes(code))?.[1] ?? "cloud";
        const nowH = new Date().getHours();
        let rainAt: string | null = null;
        j.hourly.time.forEach((t, i) => {
          const h = Number(t.slice(11, 13));
          if (!rainAt && h > nowH && h >= 8 && h <= 21 && (j.hourly.precipitation_probability[i] ?? 0) >= 60) {
            rainAt = h > 12 ? `rain ${h - 12}pm` : `rain ${h}am`;
          }
        });
        hub.db.kvSet("weather", { icon, temp: Math.round(j.current.temperature_2m), rainAt, fetchedAt: Date.now() } satisfies Weather);
        hub.bus.changed("weather");
      } catch {
        /* offline — keep the last reading */
      }
    },
  };
}
