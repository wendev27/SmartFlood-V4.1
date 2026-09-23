"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getSensors } from "@/services/sensorsService";
import { getSensorWeather, type SensorWeather } from "@/services/sensorWeatherService";
import { fetchJson } from "@/services/apiClient";
import { resolveSensorCoordinates } from "@/lib/sensorMapping";
import { getFloodStatusLabel } from "@/lib/statusStyles";
import styles from "./SensorSimulator.module.css";

type SensorRecord = Record<string, unknown>;
type SensorState = {
  running: boolean;
  sending: boolean;
  lastSentAt: string | null;
  waterLevelM: number | null;
  status: string | null;
  weather: SensorWeather | null;
  error: string | null;
};
type SimulationResponse = {
  sensorId: string;
  active: boolean;
  mode: string;
  status: string;
  waterLevelM: number | null;
};

const SEND_INTERVAL_MS = 3000;
const EMPTY_STATE: SensorState = {
  running: false,
  sending: false,
  lastSentAt: null,
  waterLevelM: null,
  status: null,
  weather: null,
  error: null,
};

export default function SensorSimulatorPage() {
  const sensorsQuery = useQuery({
    queryKey: ["sensor-simulator", "sensors"],
    queryFn: getSensors,
    staleTime: 5000,
    refetchInterval: 10000,
  });
  const sensors = sensorsQuery.data ?? [];
  const sensorsRef = useRef<SensorRecord[]>([]);
  const [sensorStates, setSensorStates] = useState<Record<string, SensorState>>({});
  const timersRef = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const requestsRef = useRef(new Set<string>());

  useEffect(() => {
    sensorsRef.current = sensors;
  }, [sensors]);

  useEffect(() => {
    const currentIds = new Set(sensors.map(sensorIdFrom));
    for (const [sensorId, timer] of timersRef.current) {
      if (!currentIds.has(sensorId)) {
        clearInterval(timer);
        timersRef.current.delete(sensorId);
      }
    }
    setSensorStates((current) => Object.fromEntries(
      Object.entries(current).filter(([sensorId]) => currentIds.has(sensorId)),
    ));
  }, [sensors]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearInterval(timer);
      timersRef.current.clear();
    };
  }, []);

  function updateSensorState(sensorId: string, update: Partial<SensorState>) {
    setSensorStates((current) => ({
      ...current,
      [sensorId]: { ...EMPTY_STATE, ...current[sensorId], ...update },
    }));
  }

  async function sendOnce(sensorId: string) {
    if (requestsRef.current.has(sensorId)) return;
    const sensor = sensorsRef.current.find((candidate) => sensorIdFrom(candidate) === sensorId);
    if (!sensor) return;

    requestsRef.current.add(sensorId);
    updateSensorState(sensorId, { sending: true, error: null });

    try {
      const coordinates = resolveSensorCoordinates(sensor);
      if (!coordinates) throw new Error("Missing sensor coordinates; weather-aware simulation cannot run.");

      const weather = await getSensorWeather(coordinates.lat, coordinates.lng);
      const response = await fetchJson<SimulationResponse[]>("/api/sensors/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sensorId,
          active: true,
          currentRainMmHr: weather.currentRainIntensityMmHr,
          forecastPrecipitationProbability: weather.forecastPrecipitationProbability,
          weatherProvider: weather.provider,
          weatherObservedAt: weather.observedAt,
        }),
      });
      const result = response[0];
      updateSensorState(sensorId, {
        sending: false,
        lastSentAt: new Date().toISOString(),
        waterLevelM: result?.waterLevelM ?? null,
        status: result?.status ?? null,
        weather,
        error: null,
      });
    } catch (error) {
      updateSensorState(sensorId, {
        sending: false,
        error: error instanceof Error ? error.message : "Unable to send this sensor reading.",
      });
    } finally {
      requestsRef.current.delete(sensorId);
    }
  }

  function startSensor(sensorId: string) {
    if (timersRef.current.has(sensorId)) return;
    updateSensorState(sensorId, { running: true, error: null });
    void sendOnce(sensorId);
    const timer = setInterval(() => void sendOnce(sensorId), SEND_INTERVAL_MS);
    timersRef.current.set(sensorId, timer);
  }

  function stopSensor(sensorId: string) {
    const timer = timersRef.current.get(sensorId);
    if (timer) clearInterval(timer);
    timersRef.current.delete(sensorId);
    updateSensorState(sensorId, { running: false, error: null });
    void setSensorInactive(sensorId);
  }

  async function setSensorInactive(sensorId: string) {
    try {
      await fetchJson<SimulationResponse[]>("/api/sensors/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sensorId, active: false }),
      });
    } catch (error) {
      updateSensorState(sensorId, {
        error: error instanceof Error ? error.message : "Unable to stop this sensor.",
      });
    }
  }

  const isLoading = sensorsQuery.isLoading;
  const queryError = sensorsQuery.error instanceof Error ? sensorsQuery.error.message : "Unable to load sensors.";

  return (
    <main className={styles.page}>
      <section className={styles.container}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Demo Utility</p>
          <h1>SmartFlood Sensor Simulator</h1>
          <p>Each registered sensor runs independently using live coordinate-specific weather input.</p>
        </header>

        {isLoading ? <p className={styles.notice}>Loading registered sensors...</p> : null}
        {sensorsQuery.isError ? <p className={styles.error} role="alert">{queryError}</p> : null}
        {!isLoading && !sensorsQuery.isError && sensors.length === 0 ? (
          <p className={styles.notice}>No registered sensors are available for this account.</p>
        ) : null}

        <div className={styles.sensorGrid}>
          {sensors.map((sensor) => {
            const sensorId = sensorIdFrom(sensor);
            const state = sensorStates[sensorId] ?? EMPTY_STATE;
            const waterLevelM = state.waterLevelM ?? numberValue(sensor.waterLevelM ?? sensor.waterLevel);
            const status = state.status ?? stringValue(sensor.computedStatus ?? sensor.status);
            const barangay = stringValue(sensor.barangayName ?? sensor.barangay ?? sensor.locationName) || "Unknown barangay";
            const coordinates = resolveSensorCoordinates(sensor);

            return (
              <article className={styles.card} key={sensorId}>
                <div className={styles.cardHeader}>
                  <div>
                    <p className={styles.sensorId}>{sensorId}</p>
                    <h2>{barangay}</h2>
                  </div>
                  <span className={state.running ? styles.running : styles.stopped}>
                    {state.running ? "Running" : "Stopped"}
                  </span>
                </div>

                <dl className={styles.metrics}>
                  <div><dt>Sensor status</dt><dd>{stringValue(sensor.status) || "Unknown"}</dd></div>
                  <div><dt>Weather rain</dt><dd>{state.weather ? String(state.weather.currentRainIntensityMmHr.toFixed(2)) + " mm/hr" : "-"}</dd></div>
                  <div><dt>Synthetic water</dt><dd>{waterLevelM == null ? "-" : String(waterLevelM.toFixed(3)) + " m"}</dd></div>
                  <div><dt>Flood level</dt><dd>{getFloodStatusLabel(status, waterLevelM)}</dd></div>
                  <div><dt>Last sent</dt><dd>{state.lastSentAt ? new Date(state.lastSentAt).toLocaleTimeString() : "-"}</dd></div>
                  <div><dt>Coordinates</dt><dd>{coordinates ? String(coordinates.lat.toFixed(5)) + ", " + String(coordinates.lng.toFixed(5)) : "Missing"}</dd></div>
                </dl>
                {state.weather ? (
                  <div className={styles.weatherNote}>
                    <p>Current rain: {String(state.weather.currentRainIntensityMmHr.toFixed(2))} mm/hr</p>
                    <p>Forecast probability: {state.weather.forecastPrecipitationProbability == null ? '-' : String(state.weather.forecastPrecipitationProbability.toFixed(0)) + '%'}</p>
                    <p>Forecast precipitation: {state.weather.forecastPrecipitationMm == null ? '-' : String(state.weather.forecastPrecipitationMm.toFixed(2)) + ' mm'}</p>
                    <p>Provider: {state.weather.provider}</p>
                  </div>
                ) : null}
                {state.error ? <p className={styles.cardError} role="alert">{state.error}</p> : null}

                <div className={styles.cardActions}>
                  <button className={styles.primaryButton} type="button" onClick={() => startSensor(sensorId)} disabled={state.running || state.sending}>Start</button>
                  <button className={styles.stopButton} type="button" onClick={() => stopSensor(sensorId)} disabled={!state.running}>Stop</button>
                  <button className={styles.secondaryButton} type="button" onClick={() => void sendOnce(sensorId)} disabled={state.sending}>{state.sending ? "Sending..." : "Send Once"}</button>
                </div>
              </article>
            );
          })}
        </div>

        <div className={styles.actions}>
          <Link className={styles.secondaryButton} href="/dashboard#sensors">Open Dashboard</Link>
        </div>
      </section>
    </main>
  );
}

function sensorIdFrom(sensor: SensorRecord) {
  return stringValue(sensor.sensorId ?? sensor.sensor_id ?? sensor._id) || "unknown-sensor";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
