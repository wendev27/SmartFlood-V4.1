import "server-only";
import type { WeatherData } from "@/types/weather";
import { array, object, openWeatherConditions, timezone, tomorrowConditions, tomorrowForecast } from "./weatherMapping";

// One public city forecast, independent of resident records and dashboard authorization.
// Coordinates avoid ambiguous city-name geocoding (there is another Malabon in the Philippines).
const coordinates = { lat: "14.66651", lon: "120.96531" };
const ttl = 10 * 60 * 1000;
let cached: { until: number; value: WeatherData } | null = null;
let pending: Promise<WeatherData> | null = null;
let failedUntil = 0;

async function provider(url: string, params: Record<string, string>): Promise<unknown> {
  try {
    const response = await fetch(`${url}?${new URLSearchParams(params)}`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Never expose provider URLs, credentials, response bodies or fetch errors to clients/logs.
    return null;
  }
}

async function loadWeather(): Promise<WeatherData> {
  const tomorrowKey = process.env.TOMORROW_API_KEY;
  const openWeatherKey = process.env.OPENWEATHER_API_KEY;
  if (!tomorrowKey && !openWeatherKey) throw new Error("Weather is not configured. Add the weather keys to this deployment's server environment.");
  const params = { location: `${coordinates.lat},${coordinates.lon}`, units: "metric", apikey: tomorrowKey ?? "" };
  const [realtime, forecast] = tomorrowKey ? await Promise.all([
    provider("https://api.tomorrow.io/v4/weather/realtime", params),
    provider("https://api.tomorrow.io/v4/weather/forecast", params),
  ]) : [null, null];
  let current = tomorrowConditions(object(realtime).data);
  let { hourly, daily } = tomorrowForecast(forecast);
  let intervalHours: 1 | 3 = 1;
  const sources = new Set<string>();
  if (current || hourly.length || daily.length) sources.add("Tomorrow.io");
  if (openWeatherKey && (!current || !hourly.length)) {
    const fallbackParams = { ...coordinates, units: "metric", appid: openWeatherKey };
    const [fallbackCurrent, fallbackForecast] = await Promise.all([
      current ? Promise.resolve(null) : provider("https://api.openweathermap.org/data/2.5/weather", fallbackParams),
      hourly.length ? Promise.resolve(null) : provider("https://api.openweathermap.org/data/2.5/forecast", fallbackParams),
    ]);
    const observation = openWeatherConditions(fallbackCurrent);
    if (!current && observation) { current = observation; sources.add("OpenWeather"); }
    if (!hourly.length) {
      hourly = array(object(fallbackForecast).list).map(openWeatherConditions).filter((row): row is NonNullable<typeof row> => row !== null && Date.parse(row.time) >= Date.now()).slice(0, 8);
      if (hourly.length) { intervalHours = 3; sources.add("OpenWeather"); }
    }
  }
  if (!current && !hourly.length && !daily.length) throw new Error("Weather providers are unavailable. Check the API keys, provider access and request limits, then retry.");
  const notices: string[] = [];
  if (!current) notices.push("Current observations are temporarily unavailable.");
  if (!hourly.length) notices.push("Hourly forecasts are temporarily unavailable.");
  if (!daily.length) notices.push("Daily forecasts are unavailable from the current provider response.");
  else if (daily.length < 7) notices.push(`The provider returned ${daily.length} forecast days; additional days are unavailable.`);
  return { location: "Malabon City", timezone, fetchedAt: new Date().toISOString(), current, hourly, daily, intervalHours, sources: [...sources], notices };
}

export async function getWeather(): Promise<WeatherData> {
  if (cached && cached.until > Date.now()) return cached.value;
  if (pending) return pending;
  if (failedUntil > Date.now()) throw new Error("Weather is temporarily unavailable. Please retry in a minute.");
  pending = loadWeather().then((value) => { cached = { value, until: Date.now() + ttl }; failedUntil = 0; return value; })
    .catch((error) => { failedUntil = Date.now() + 60_000; throw error; }).finally(() => { pending = null; });
  return pending;
}




export type SensorWeather = {
  currentRainIntensityMmHr: number;
  forecastPrecipitationProbability: number | null;
  forecastPrecipitationMm: number | null;
  observedAt: string;
  provider: "tomorrow" | "openweather";
};

const sensorWeatherTtl = 5 * 60 * 1000;
const sensorWeatherCache = new Map<string, { until: number; value: SensorWeather }>();
const sensorWeatherPending = new Map<string, Promise<SensorWeather>>();
const sensorWeatherFailedUntil = new Map<string, number>();

export async function getSensorWeather(lat: number, lng: number): Promise<SensorWeather> {
  const key = String(lat.toFixed(3)) + "," + String(lng.toFixed(3));
  const cachedSensorWeather = sensorWeatherCache.get(key);
  if (cachedSensorWeather && cachedSensorWeather.until > Date.now()) return cachedSensorWeather.value;
  if ((sensorWeatherFailedUntil.get(key) ?? 0) > Date.now()) {
    throw new Error("Weather is temporarily unavailable. Please retry shortly.");
  }

  const existingRequest = sensorWeatherPending.get(key);
  if (existingRequest) return existingRequest;

  const request = loadSensorWeather(lat, lng)
    .then((value) => {
      sensorWeatherCache.set(key, { value, until: Date.now() + sensorWeatherTtl });
      sensorWeatherFailedUntil.delete(key);
      return value;
    })
    .catch(() => {
      sensorWeatherFailedUntil.set(key, Date.now() + 60_000);
      throw new Error("Weather is temporarily unavailable. Please retry shortly.");
    })
    .finally(() => sensorWeatherPending.delete(key));

  sensorWeatherPending.set(key, request);
  return request;
}

async function loadSensorWeather(lat: number, lng: number): Promise<SensorWeather> {
  const tomorrowKey = process.env.TOMORROW_API_KEY;
  const openWeatherKey = process.env.OPENWEATHER_API_KEY;
  let tomorrowForecastData: { probability: number | null; amount: number | null } | null = null;

  if (tomorrowKey) {
    const params = {
      location: String(lat) + "," + String(lng),
      units: "metric",
      apikey: tomorrowKey,
    };
    const [realtime, forecast] = await Promise.all([
      provider("https://api.tomorrow.io/v4/weather/realtime", params),
      provider("https://api.tomorrow.io/v4/weather/forecast", params),
    ]);
    tomorrowForecastData = parseTomorrowSensorForecast(forecast);
    const current = parseTomorrowSensorWeather(realtime);
    if (current) {
      return {
        ...current,
        forecastPrecipitationProbability: tomorrowForecastData?.probability ?? null,
        forecastPrecipitationMm: tomorrowForecastData?.amount ?? null,
      };
    }
  }

  if (openWeatherKey) {
    const currentParams = {
      lat: String(lat),
      lon: String(lng),
      units: "metric",
      appid: openWeatherKey,
    };
    const [currentResponse, forecastResponse] = await Promise.all([
      provider("https://api.openweathermap.org/data/2.5/weather", currentParams),
      provider("https://api.openweathermap.org/data/2.5/forecast", currentParams),
    ]);
    const current = parseOpenWeatherSensorWeather(currentResponse);
    if (current) {
      const forecast = parseOpenWeatherSensorForecast(forecastResponse);
      return {
        ...current,
        forecastPrecipitationProbability: forecast?.probability ?? tomorrowForecastData?.probability ?? null,
        forecastPrecipitationMm: forecast?.amount ?? tomorrowForecastData?.amount ?? null,
      };
    }
  }

  throw new Error("Weather providers are unavailable.");
}

function parseTomorrowSensorWeather(payload: unknown): Omit<SensorWeather, "forecastPrecipitationProbability" | "forecastPrecipitationMm"> | null {
  const data = object(object(payload).data);
  const values = object(data.values);
  const intensity = firstFinite(values.precipitationIntensity, values.rainIntensity, values.precipitationIntensityMmHr);
  const observedAt = typeof data.time === "string" && !Number.isNaN(Date.parse(data.time))
    ? new Date(data.time).toISOString()
    : new Date().toISOString();

  if (data.time == null && intensity == null) return null;

  return {
    currentRainIntensityMmHr: Math.max(0, intensity ?? 0),
    observedAt,
    provider: "tomorrow",
  };
}

function parseTomorrowSensorForecast(payload: unknown) {
  const timelines = object(object(payload).timelines);
  const hourly = Array.isArray(timelines.hourly) ? timelines.hourly : [];
  const first = object(hourly[0]);
  const values = object(first.values);
  const probability = firstFinite(values.precipitationProbability);
  const amount = firstFinite(values.precipitationAccumulation, values.rainAccumulation, values.precipitationAmount);
  if (probability == null && amount == null) return null;
  return {
    probability: probability == null ? null : clamp(probability, 0, 100),
    amount: amount == null ? null : Math.max(0, amount),
  };
}

function parseOpenWeatherSensorWeather(payload: unknown): Omit<SensorWeather, "forecastPrecipitationProbability" | "forecastPrecipitationMm"> | null {
  const row = object(payload);
  const rain = object(row.rain);
  const oneHour = firstFinite(rain["1h"]);
  const threeHours = firstFinite(rain["3h"]);
  const timestamp = typeof row.dt === "number" && Number.isFinite(row.dt) ? row.dt * 1000 : Date.now();

  if (Object.keys(row).length === 0) return null;

  return {
    currentRainIntensityMmHr: Math.max(0, oneHour ?? (threeHours == null ? 0 : threeHours / 3)),
    observedAt: new Date(timestamp).toISOString(),
    provider: "openweather",
  };
}

function parseOpenWeatherSensorForecast(payload: unknown) {
  const listValue = object(payload).list;
  const list = Array.isArray(listValue) ? listValue : [];
  const first = object(list[0]);
  const rain = object(first.rain);
  const amount = firstFinite(rain["3h"], rain["1h"]);
  const probability = firstFinite(first.pop);
  if (probability == null && amount == null) return null;
  return {
    probability: probability == null ? null : clamp(probability <= 1 ? probability * 100 : probability, 0, 100),
    amount: amount == null ? null : Math.max(0, amount),
  };
}

function firstFinite(...values: unknown[]) {
  for (const value of values) {
    const number = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
