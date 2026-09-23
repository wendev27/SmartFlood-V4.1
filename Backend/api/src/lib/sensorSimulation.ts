export const SIMULATION_TIME_SCALE = 20;
export const SIMULATION_MINUTES_PER_TICK = 1;
export const DRAINAGE_METERS_PER_SIMULATED_HOUR = 0.12;
export const DRY_DRAINAGE_METERS_PER_SIMULATED_HOUR = 3.6;
export const DRY_RAIN_THRESHOLD_MM_HR = 0.1;
export const RUNOFF_RESPONSE_FACTOR = 12;

export function elapsedSimulationHours(createdAt: unknown, now: Date): number {
  const createdAtMs = createdAt instanceof Date ? createdAt.getTime() : new Date(String(createdAt ?? "")).getTime();
  if (!Number.isFinite(createdAtMs)) return SIMULATION_MINUTES_PER_TICK / 60;

  const realElapsedHours = Math.max(0, now.getTime() - createdAtMs) / 3_600_000;
  return clamp(realElapsedHours * SIMULATION_TIME_SCALE, SIMULATION_MINUTES_PER_TICK / 60, 6);
}

export function advanceSyntheticWaterLevel(
  previousWaterLevelM: number,
  currentRainMmHr: number,
  elapsedHours: number,
  hasPreviousReading = true,
): number {
  const rainRunoffM = Math.max(0, currentRainMmHr) * 0.001 * RUNOFF_RESPONSE_FACTOR * elapsedHours;
  const drainageRate = currentRainMmHr <= DRY_RAIN_THRESHOLD_MM_HR
    ? DRY_DRAINAGE_METERS_PER_SIMULATED_HOUR
    : DRAINAGE_METERS_PER_SIMULATED_HOUR;
  const drainageM = drainageRate * elapsedHours * (1 + Math.max(0, previousWaterLevelM) * 0.15);
  const noiseM = hasPreviousReading ? (Math.random() * 2 - 1) * 0.0003 * Math.sqrt(elapsedHours / (SIMULATION_MINUTES_PER_TICK / 60)) : 0;
  return round(clamp(previousWaterLevelM + rainRunoffM - drainageM + noiseM, 0, 1.8), 3);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
