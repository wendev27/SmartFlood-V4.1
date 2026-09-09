"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { MapPanel } from "@/components/dashboard/MapPanel/MapPanel";
import { useWeather } from "@/components/weather/useWeather";
import { weatherDetails, weatherImage, weatherTime, weatherValue } from "@/adapters/weatherPresentation";
import { useDashboardPresentation } from "@/components/layout/DashboardPresentationContext";
import { Badge } from "@/components/ui/Badge/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination as SharedPagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import { getFloodBadgeTone, getFloodStatusClass, getFloodStatusLabel, type FloodLevel } from "@/lib/statusStyles";
import { formatBarangayName, formatSensorUpdatedTime } from "@/lib/formatters";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import { StatCard } from "@/components/ui/StatCard/StatCard";
import { getSensors } from "@/services/sensorsService";
import type { DashboardStat } from "@/types/dashboard";
import styles from "./DashboardPanel.module.css";

export function DashboardPanel() {
  const presentation = useDashboardPresentation();
  const weather = useWeather();
  const currentWeather = weather.data?.current;
  const forecastRows = weather.data?.hourly ?? [];
  const pageSize = 5;
  const [showSevereOnly, setShowSevereOnly] = useState(false);
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);
  const [sensorPage, setSensorPage] = useState(1);
  const sensorsQuery = useQuery({
    queryKey: queryKeys.sensors.latest,
    queryFn: getSensors,
    staleTime: queryStaleTime.realTime,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  const sensorRows = sensorsQuery.data ?? [];
  const isLoading = sensorsQuery.isPending;
  const error = sensorsQuery.error instanceof Error ? sensorsQuery.error.message : sensorsQuery.error ? "Unable to load dashboard data." : "";

  const severeSensors = useMemo(() => sensorRows.filter((row) => sensorFloodLevel(row) === "severity"), [sensorRows]);
  const visibleSensorRows = showSevereOnly ? severeSensors : sensorRows;
  const paginatedSensorRows = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(visibleSensorRows.length / pageSize));
    const safePage = Math.min(sensorPage, totalPages);
    return {
      rows: visibleSensorRows.slice((safePage - 1) * pageSize, safePage * pageSize),
      pagination: { page: safePage, limit: pageSize, total: visibleSensorRows.length, totalPages } satisfies PaginationState,
    };
  }, [sensorPage, visibleSensorRows]);

  useEffect(() => {
    setSensorPage(1);
  }, [showSevereOnly]);

  useEffect(() => {
    if (sensorPage !== paginatedSensorRows.pagination.page) setSensorPage(paginatedSensorRows.pagination.page);
  }, [paginatedSensorRows.pagination.page, sensorPage]);

  const simpleStats = useMemo<DashboardStat[]>(() => {
    return [
      {
        label: "Sensor Nodes",
        value: isLoading ? "..." : error ? "Unavailable" : String(sensorRows.length),
        caption: isLoading ? "Loading sensor network" : "Live sensor nodes",
        tone: "blue",
        captionTone: "info",
      },
      {
        label: "Severe Alerts",
        value: isLoading ? "..." : error ? "Unavailable" : String(severeSensors.length),
        caption: showSevereOnly ? "Showing severe sensors" : "View severe sensors",
        tone: "cyan",
        captionTone: severeSensors.length > 0 ? "danger" : "success",
      },
    ];
  }, [error, isLoading, sensorRows.length, severeSensors.length, showSevereOnly]);

  function openSensorManagement() {
    window.location.hash = "#sensors";
  }

  function selectDashboardSensor(sensorId: string) {
    setSelectedSensorId(sensorId);
    setShowSevereOnly(false);
  }

  useEffect(() => {
    if (!selectedSensorId) return;
    if (!sensorRows.some((sensor, index) => sensorKey(sensor, index) === selectedSensorId)) {
      setSelectedSensorId(null);
    }
  }, [selectedSensorId, sensorRows]);

  return (
    <div className={styles.dashboard}>
      <section className={styles.weatherRow} aria-label="Malabon City weather">
        <button type="button" className={styles.weatherOverview} onClick={() => presentation?.open("weatherForecast")} aria-label="Open weather forecast">
          <div className={styles.weatherCurrent}>
            <img src={weatherImage(currentWeather?.icon, currentWeather?.time)} alt="" />
            <div><span>Malabon City Weather</span><strong>{weather.isPending ? "…" : weatherValue(currentWeather?.temperature, "°C")}</strong><p>{currentWeather?.description ?? (weather.isPending ? "Loading…" : "Unavailable")}</p></div>
          </div>
          <div className={styles.weatherDetails} aria-label="Current weather measurements">
            {weatherDetails(currentWeather).map(({ label, value }) => (
              <div key={label}><span>{label}</span><strong>{weather.isPending ? "…" : value}</strong></div>
            ))}
          </div>
        </button>
        <button type="button" className={styles.hourlyPreview} onClick={() => presentation?.open("weatherForecast")} aria-label="Open hourly weather forecast">
          <h2>{weather.data?.intervalHours === 3 ? "3-Hour Forecast" : "Hourly Forecast"}</h2>
          <div>
            {forecastRows.map((row) => <article key={row.time} title={row.description}>
              <span>{weatherTime(row.time)}</span><img src={weatherImage(row.icon, row.time)} alt={row.description} /><strong>{weatherValue(row.temperature, "°C")}</strong>
            </article>)}
            {weather.isPending ? Array.from({ length: 8 }, (_, index) => <article key={index} aria-hidden="true"><span>…</span><span className={styles.forecastIconPlaceholder} /><strong>…</strong></article>) : null}
          </div>
          {weather.isPending ? <p className={styles.unavailable}>Loading Malabon City weather…</p> : null}
          {weather.error ? <p className={styles.unavailable}>Weather could not refresh. Open details or retry below.</p> : null}
          {!weather.isPending && !weather.error && !forecastRows.length ? <p className={styles.unavailable}>Forecast temporarily unavailable.</p> : null}
        </button>
        {weather.isError ? <div className={styles.weatherError} role="alert"><span>{weather.error.message}</span><button type="button" disabled={weather.isFetching} onClick={() => weather.refetch()}>Retry weather</button></div> : null}
      </section>
      <section className={styles.statsGrid} aria-label="Dashboard statistics">
        {simpleStats.map((stat, index) => (
          <StatCard
            isActive={index === 1 && showSevereOnly}
            key={stat.label}
            onClick={index === 0 ? openSensorManagement : () => setShowSevereOnly((current) => !current)}
            stat={stat}
          />
        ))}
      </section>
      <section className={styles.mapSection}>
        <MapPanel
          variant="embedded"
          sensors={showSevereOnly ? severeSensors : sensorRows}
          isLoading={isLoading}
          error={error}
          onRetry={() => sensorsQuery.refetch()}
          selectedSensorId={selectedSensorId}
          onSensorSelect={setSelectedSensorId}
          focusZoom={18}
        />
      </section>
      <section className={styles.sensorSection} aria-label="Available sensors">
        <div className={styles.sensorHeader}>
          <div>
            <h3>Available Sensors</h3>
            <p>Live sensor nodes from the monitoring network</p>
          </div>
        </div>
        {error ? <ErrorState title="Unable to Load Sensor Nodes" message={error} retryLabel="Retry" onRetry={() => sensorsQuery.refetch()} /> : null}
        {isLoading ? <LoadingState message="Loading sensor nodes..." /> : null}
        {sensorsQuery.isFetching && !sensorsQuery.isPending ? <p className={styles.errorMessage} role="status">Refreshing sensor nodes...</p> : null}
        {!isLoading && !error && sensorRows.length === 0 ? (
          <EmptyState title="No sensor nodes available." description="Sensor cards will appear when live sensor data is available." />
        ) : null}
        {!isLoading && !error && sensorRows.length > 0 ? (
          <>
          <div className={styles.sensorScroller}>
            {paginatedSensorRows.rows.map((sensor, index) => {
              const key = sensorKey(sensor, index);
              const level = sensorLevel(sensor);
              const floodLevel = sensorFloodLevel(sensor);
              const status = sensorStatus(sensor);
              return (
                <button
                  className={`${styles.sensorCard} ${styles[`${floodLevel}Sensor`]} ${selectedSensorId === key ? styles.selectedSensor : ""}`}
                  key={key}
                  type="button"
                  aria-pressed={selectedSensorId === key}
                  onClick={() => selectDashboardSensor(key)}
                >
                  <div className={styles.sensorCardTop}>
                    <strong>{String(sensor.name || sensor.sensorId || sensor.sensor_id || "Unnamed sensor")}</strong>
                    <Badge tone={status === "Active" ? "green" : status === "Inactive" ? "yellow" : "red"}>{status}</Badge>
                  </div>
                  <span>{formatBarangayName(String(sensor.barangayName ?? sensor.barangay ?? "Unknown barangay"))}</span>
                  <div className={styles.sensorMeta}>
                    <span>Reading</span>
                    <b className={styles[`${floodLevel}Reading`]}>{formatWater(sensor.waterLevelM)}</b>
                  </div>
                  <div className={styles.sensorMeta}>
                    <span>Flood Level</span>
                    <Badge tone={getFloodBadgeTone(level)}>{level}</Badge>
                  </div>
                  <small>Updated: {formatSensorUpdatedTime(sensorUpdatedAt(sensor))}</small>
                </button>
              );
            })}
          </div>
          <SharedPagination pagination={paginatedSensorRows.pagination} onPageChange={setSensorPage} label="Dashboard sensors" />
          </>
        ) : null}
      </section>
    </div>
  );
}

function sensorKey(sensor: Record<string, unknown>, index: number) {
  return String(sensor.sensorId ?? sensor.sensor_id ?? sensor._id ?? `${sensor.name ?? "sensor"}-${index}`);
}

function sensorStatus(sensor: Record<string, unknown>) {
  const status = String(sensor.status ?? "offline").toLowerCase();
  if (status === "active") return "Active";
  if (status === "inactive" || status === "degraded") return "Inactive";
  return "Offline";
}

function sensorLevel(sensor: Record<string, unknown>) {
  return getFloodStatusLabel(sensor.computedStatus ?? sensor.risk, sensor.waterLevelM);
}

function sensorFloodLevel(sensor: Record<string, unknown>): FloodLevel {
  return getFloodStatusClass(sensor.computedStatus ?? sensor.risk, sensor.waterLevelM);
}

function formatWater(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}m` : "No reading";
}

function sensorUpdatedAt(sensor: Record<string, unknown>) {
  return (sensor.latestReadingAt ?? sensor.lastSeenAt ?? sensor.updatedAt) as string | Date | null | undefined;
}
