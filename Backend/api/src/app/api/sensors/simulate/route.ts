import { ObjectId, type Document } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getFloodStatusClass } from "@/lib/statusStyles";
import { advanceSyntheticWaterLevel, elapsedSimulationHours } from "@/lib/sensorSimulation";

const SIMULATION_MODES = ["no_reading", "normal", "flood_alert", "flood_warning", "severe"] as const;
type SimulationMode = (typeof SIMULATION_MODES)[number];

type SensorSimulation = {
  sensorId: string;
  active: boolean;
  mode?: SimulationMode;
  currentRainMmHr?: number;
  rainfallMm?: number;
  forecastPrecipitationProbability?: number | null;
  precipitationProbability?: number | null;
  weatherProvider?: string;
  weatherObservedAt?: string;
};

type ReadingPreset = {
  minWaterLevelM: number;
  maxWaterLevelM: number;
  status: Exclude<SimulationMode, "no_reading">;
};

const READING_PRESETS: Record<Exclude<SimulationMode, "no_reading">, ReadingPreset> = {
  normal: { minWaterLevelM: 0, maxWaterLevelM: 0.24, status: "normal" },
  flood_alert: { minWaterLevelM: 0.25, maxWaterLevelM: 0.5, status: "flood_alert" },
  flood_warning: { minWaterLevelM: 0.75, maxWaterLevelM: 1, status: "flood_warning" },
  severe: { minWaterLevelM: 1.2, maxWaterLevelM: 1.5, status: "severe" },
};

export async function POST(req: NextRequest) {
  try {
    const simulations = parseSimulations(await req.json());
    const db = await getDb();
    const sensors = db.collection("sensors");
    const readings = db.collection("sensor_readings");
    const resolvedSensors = new Map<string, { sensor: Document; identifiers: string[] }>();

    for (const simulation of simulations) {
      const clauses: Document[] = [
        { _id: simulation.sensorId },
        { sensorId: simulation.sensorId },
        { sensor_id: simulation.sensorId },
      ];
      if (ObjectId.isValid(simulation.sensorId)) clauses.push({ _id: new ObjectId(simulation.sensorId) });
      const sensor = await sensors.findOne({ $or: clauses });
      if (!sensor) {
        return NextResponse.json({ success: false, error: "Sensor " + simulation.sensorId + " was not found." }, { status: 404 });
      }
      resolvedSensors.set(simulation.sensorId, { sensor, identifiers: sensorIdentifiers(sensor, simulation.sensorId) });
    }

    const data = [];
    for (const simulation of simulations) {
      const now = new Date();
      const resolved = resolvedSensors.get(simulation.sensorId);
      if (!resolved) continue;
      const filter = { _id: resolved.sensor._id };
      const identifiers = resolved.identifiers;

      if (!simulation.active) {
        await sensors.updateOne(filter, { $set: { status: "inactive", updatedAt: now } });
        data.push({ sensorId: simulation.sensorId, active: false, mode: simulation.mode ?? "weather-aware", status: "inactive", waterLevelM: null });
        continue;
      }

      await sensors.updateOne(filter, { $set: { status: "active", lastSeenAt: now, updatedAt: now } });

      if (simulation.mode === "no_reading") {
        await readings.deleteMany({ sensorId: { $in: identifiers } });
        data.push({ sensorId: simulation.sensorId, active: true, mode: simulation.mode, status: "no_reading", waterLevelM: null });
        continue;
      }

      const preset = simulation.mode ? READING_PRESETS[simulation.mode] : null;
      const previous = preset ? null : await readings.findOne({ sensorId: { $in: identifiers } }, { sort: { createdAt: -1 } });
      const hasPreviousReading = Boolean(previous);
      const previousWaterLevelM = numberValue(previous?.waterLevelM ?? previous?.waterLevel) ?? 0;
      const currentRainMmHr = simulation.currentRainMmHr ?? simulation.rainfallMm ?? 0;
      const elapsedHours = preset ? 0 : elapsedSimulationHours(previous?.createdAt, now);
      const waterLevelM = preset ? randomWaterLevel(preset) : advanceSyntheticWaterLevel(previousWaterLevelM, currentRainMmHr, elapsedHours, hasPreviousReading);
      const status = preset?.status ?? getFloodStatusClass(undefined, waterLevelM);
      const distanceCm = Math.max(30, Math.round((220 - waterLevelM * 100) * 100) / 100);

      await readings.insertOne({
        sensorId: identifiers[0],
        waterLevelM,
        waterLevel: waterLevelM,
        distanceCm,
        rainfallMm: currentRainMmHr,
        currentRainMmHr,
        rainfallMmHr: currentRainMmHr,
        forecastPrecipitationProbability: simulation.forecastPrecipitationProbability ?? null,
        weatherProvider: simulation.weatherProvider ?? null,
        weatherObservedAt: simulation.weatherObservedAt ? new Date(simulation.weatherObservedAt) : null,
        batteryPct: null,
        computedStatus: status,
        status,
        source: preset ? "manual-simulator" : "weather-aware-simulator",
        simulated: true,
        createdAt: now,
        updatedAt: now,
        __v: 0,
      });

      data.push({
        sensorId: simulation.sensorId,
        active: true,
        mode: simulation.mode ?? "weather-aware",
        status,
        waterLevelM,
        rainfallMm: currentRainMmHr,
        currentRainMmHr,
        weatherProvider: simulation.weatherProvider ?? null,
        weatherObservedAt: simulation.weatherObservedAt ?? null,
      });
    }

    return NextResponse.json({ success: true, message: "Sensor simulation applied.", data });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to apply sensor simulation.";
    const status = error instanceof SimulationRequestError ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

function sensorIdentifiers(sensor: Document, requestedId: string) {
  return [...new Set([
    requestedId,
    String(sensor.sensorId ?? ""),
    String(sensor.sensor_id ?? ""),
    String(sensor._id ?? ""),
  ].filter(Boolean))];
}

function randomWaterLevel(preset: ReadingPreset) {
  const value = preset.minWaterLevelM + Math.random() * (preset.maxWaterLevelM - preset.minWaterLevelM);
  return Math.round(value * 100) / 100;
}

function parseSimulations(body: unknown): SensorSimulation[] {
  if (!isRecord(body)) throw new SimulationRequestError("Request body must be a sensor simulation object.");
  const entries = Array.isArray(body.sensors) ? body.sensors : [body];
  if (entries.length === 0) throw new SimulationRequestError("Request must include at least one sensor.");
  const seenSensorIds = new Set<string>();

  return entries.map((entry, index) => {
    if (!isRecord(entry)) throw new SimulationRequestError("Sensor entry at index " + index + " must be an object.");
    const sensorId = typeof entry.sensorId === "string" ? entry.sensorId.trim() : "";
    if (!sensorId) throw new SimulationRequestError("Sensor entry at index " + index + " is missing sensorId.");
    if (seenSensorIds.has(sensorId)) throw new SimulationRequestError("Sensor " + sensorId + " was included more than once.");
    seenSensorIds.add(sensorId);

    if (typeof entry.active !== "boolean") throw new SimulationRequestError("Sensor " + sensorId + " must include an active boolean.");
    const mode = entry.mode == null ? undefined : entry.mode;
    if (mode !== undefined && (typeof mode !== "string" || !isSimulationMode(mode))) {
      throw new SimulationRequestError("Sensor " + sensorId + " has an invalid mode.");
    }

    const currentRainMmHr = entry.currentRainMmHr == null ? undefined : Number(entry.currentRainMmHr);
    const rainfallMm = entry.rainfallMm == null ? undefined : Number(entry.rainfallMm);
    const normalizedRain = currentRainMmHr ?? rainfallMm;
    if (entry.active && mode === undefined && (normalizedRain == null || !Number.isFinite(normalizedRain) || normalizedRain < 0)) {
      throw new SimulationRequestError("Sensor " + sensorId + " requires a valid rainfallMm value.");
    }

    const probabilityInput = entry.forecastPrecipitationProbability ?? entry.precipitationProbability;
    const probability = probabilityInput == null ? null : Number(probabilityInput);
    if (probability != null && (!Number.isFinite(probability) || probability < 0 || probability > 100)) {
      throw new SimulationRequestError("Sensor " + sensorId + " has an invalid precipitation probability.");
    }

    return {
      sensorId,
      active: entry.active,
      mode,
      currentRainMmHr: normalizedRain == null ? undefined : Math.min(normalizedRain, 500),
      rainfallMm: rainfallMm == null ? undefined : Math.min(rainfallMm, 500),
      forecastPrecipitationProbability: probability,
      weatherProvider: typeof entry.weatherProvider === "string" ? entry.weatherProvider.slice(0, 32) : undefined,
      weatherObservedAt: typeof entry.weatherObservedAt === "string" && !Number.isNaN(Date.parse(entry.weatherObservedAt)) ? entry.weatherObservedAt : undefined,
    };
  });
}

function isSimulationMode(value: string): value is SimulationMode {
  return SIMULATION_MODES.some((mode) => mode === value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

class SimulationRequestError extends Error {}
