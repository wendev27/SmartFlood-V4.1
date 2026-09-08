"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { notificationPresentation, type NotificationRow } from "@/adapters/notificationPresentation";
import { getEmergencyNotifications } from "@/services/emergencyService";
import { getSensors } from "@/services/sensorsService";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import { getFloodStatusClass } from "@/lib/statusStyles";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import type { DashboardRole, PageKey } from "@/types/navigation";
import styles from "./NotificationPanel.module.css";

type Filter = "All" | "Unread" | "Alert" | "Relief" | "System";
const filters: Filter[] = ["All", "Unread", "Alert", "Relief", "System"];

export function NotificationPanel({ role, onBack, onNavigate, onOpenAllocation }: {
  role: DashboardRole;
  onBack: () => void;
  onNavigate: (page: PageKey) => void;
  onOpenAllocation: (id: string) => void;
}) {
  // Match the existing GET route; CDRRMO cannot read the barangay relief inbox.
  const canList = role === "barangay" || role === "cswdd" || role === "super";
  const inboxQuery = useQuery({ queryKey: queryKeys.notifications.emergency, queryFn: () => getEmergencyNotifications(), enabled: canList, staleTime: queryStaleTime.operational });
  const sensorsQuery = useQuery({ queryKey: queryKeys.sensors.latest, queryFn: getSensors, staleTime: queryStaleTime.realTime, refetchInterval: 5000 });
  const rows = useMemo(() => canList ? notificationPresentation(inboxQuery.data ?? []) : [], [canList, inboxQuery.data]);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const ready = canList && !inboxQuery.isPending && !inboxQuery.isError;
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => (filter === "All" || (filter === "Unread" ? row.unread : row.category === filter)) && (!term || `${row.title} ${row.message}`.toLowerCase().includes(term)));
  }, [rows, filter, query]);
  const severeCount = sensorsQuery.isPending ? "…" : sensorsQuery.isError ? "Unavailable" : (sensorsQuery.data ?? []).filter((sensor) => getFloodStatusClass(sensor.computedStatus, sensor.waterLevelM) === "severity").length;
  const total = !canList || inboxQuery.isError ? "Unavailable" : inboxQuery.isPending ? "…" : rows.length;
  const unread = ready ? rows.filter((row) => row.unread).length : total;

  function openNotification(row: NotificationRow) {
    if (!row.isAllocation) return;
    // The existing allocation controller owns PATCH/read and allocation actions.
    if (role === "barangay") onOpenAllocation(row.id);
    else onNavigate("reliefManagement");
  }

  return <section className={styles.page}>
    <button className={styles.back} type="button" onClick={onBack}>‹ Back</button>
    <h1>Notification</h1>
    <div className={styles.toolbar}>
      <div className={styles.filters}>{filters.map((item) => <button className={filter === item ? styles.active : ""} key={item} type="button" disabled={!canList || item === "Alert" || item === "System"} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>)}</div>
      <label className={styles.search}><span aria-hidden="true" /><input type="search" aria-label="Search notifications" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requests..." disabled={!canList} /></label>
    </div>
    <div className={styles.summary}>
      <Summary label="Relief Notifications" value={total} icon="bell" />
      <Summary label={role === "barangay" ? "Unread" : "Unread by Barangay"} value={unread} icon="mail" />
      <Summary label="Severe Sensors" value={severeCount} icon="alert" />
    </div>
    <p className={styles.availabilityNote}>Alert and system notification history are unavailable. Severe sensors reflects current readings.</p>
    <div className={styles.list}>
      {!canList ? <EmptyState title="Notification inbox unavailable" description="There is no notification inbox available for your role." /> : null}
      {canList && inboxQuery.isPending ? <LoadingState message="Loading notifications…" /> : null}
      {canList && inboxQuery.isError ? <ErrorState title="Unable to load notifications" message={inboxQuery.error instanceof Error ? inboxQuery.error.message : "Please try again."} onRetry={() => inboxQuery.refetch()} /> : null}
      {ready ? visible.map((row) => <article key={row.id} role={row.isAllocation ? "link" : undefined} tabIndex={row.isAllocation ? 0 : undefined} onClick={() => openNotification(row)} onKeyDown={(event) => { if (row.isAllocation && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openNotification(row); } }} aria-label={row.isAllocation ? `Open ${row.title}` : undefined}>
        {row.unread ? <i className={styles.unread} aria-label="Unread by recipient barangay" /> : null}
        <span className={`${styles.itemIcon} ${row.category === "Relief" ? styles.relief : styles.system}`}><Symbol kind={row.category?.toLowerCase() ?? "bell"} /></span>
        <div><h2>{row.title}</h2><p>{row.message}</p></div>
      </article>) : null}
      {ready && visible.length === 0 ? <EmptyState searchResult={Boolean(query || filter !== "All")} title={rows.length ? "No notifications match" : "No relief notifications"} description={rows.length ? "We couldn’t find any notifications matching your search or active filter." : "Relief allocation notifications will appear here when available."} /> : null}
    </div>
  </section>;
}

function Summary({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  return <article><span className={styles.summaryIcon}><Symbol kind={icon} /></span><div><h2>{label}</h2><p>{value}</p></div></article>;
}

function Symbol({ kind }: { kind: string }) {
  if (kind === "mail") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>;
  if (kind === "alert") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/></svg>;
  if (kind === "relief") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v12H4zM8 8V5h8v3M4 12h16"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>;
}
