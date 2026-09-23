import { fetchJson } from "@/services/apiClient";

export type SensorWeather = {
  currentRainIntensityMmHr: number;
  forecastPrecipitationProbability: number | null;
  forecastPrecipitationMm: number | null;
  observedAt: string;
  provider: "tomorrow" | "openweather";
};

export function getSensorWeather(lat: number, lng: number) {
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  return fetchJson<SensorWeather>("/api/sensor-weather?" + params.toString(), { cache: "no-store" }, 10000);
}
