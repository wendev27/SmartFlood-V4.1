"use client";

import { useEffect, useState } from "react";
import { EmergencyNotificationsPanel } from "@/components/emergency/EmergencyNotificationsPanel/EmergencyNotificationsPanel";
import { ReliefDistributionPanel } from "@/components/emergency/ReliefDistributionPanel/ReliefDistributionPanel";
import { EmptyState } from "@/components/ui/EmptyState";
import styles from "./BarangayReliefPanel.module.css";

export type BarangayReliefView = "main" | "allocation" | "distribution" | "history" | "endorsement";

const modules: Array<{ view: Exclude<BarangayReliefView, "main">; title: string; icon: string }> = [
  { view: "allocation", title: "Relief Allocation Notification", icon: "/images/dashboard/relief-allocation.svg" },
  { view: "distribution", title: "Relief Distribution", icon: "/images/dashboard/relief-distribution.svg" },
  { view: "history", title: "Relief Distribution History", icon: "/images/dashboard/relief-history.svg" },
  { view: "endorsement", title: "Resident Relief Request Endorsement", icon: "/images/dashboard/relief-allocation.svg" },
];

type Props = {
  barangayScope?: string;
  initialView?: BarangayReliefView;
  notificationRequest?: { id: string; version: number } | null;
  onNotificationHandled?: (version: number) => void;
};

export function BarangayReliefPanel({ barangayScope, initialView = "main", notificationRequest, onNotificationHandled }: Props) {
  const [view, setView] = useState<BarangayReliefView>(initialView);
  useEffect(() => { if (notificationRequest) setView("allocation"); }, [notificationRequest]);

  if (view === "main") {
    return (
      <section className={styles.moduleGrid} aria-label="Barangay relief management modules">
        {modules.map((module) => (
          <button className={styles.moduleCard} key={module.view} type="button" onClick={() => setView(module.view)}>
            <span className={styles.moduleIcon}><img src={module.icon} alt="" /></span>
            <strong>{module.title}</strong>
          </button>
        ))}
      </section>
    );
  }

  const title = modules.find((module) => module.view === view)?.title ?? "Relief Management";
  return (
    <section className={styles.subpage} aria-label={title}>
      <button className={styles.backButton} type="button" onClick={() => setView("main")}>← Back</button>
      <h1>{title}</h1>
      <div className={styles.content}>
        {view === "allocation" ? <EmergencyNotificationsPanel openRequest={notificationRequest} onOpenRequestHandled={onNotificationHandled} /> : null}
        {view === "distribution" ? <ReliefDistributionPanel mode="distribution" barangayScope={barangayScope} forceBarangayView={Boolean(barangayScope)} /> : null}
        {view === "history" ? <ReliefDistributionPanel mode="history" barangayScope={barangayScope} forceBarangayView={Boolean(barangayScope)} /> : null}
        {view === "endorsement" ? <ReliefEndorsementEmpty /> : null}
      </div>
    </section>
  );
}

function ReliefEndorsementEmpty() {
  const [kind, setKind] = useState<"family" | "individual">("family");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const hasFilters = Boolean(status || date || search.trim());

  function clearFilters() {
    setStatus("");
    setDate("");
    setSearch("");
  }

  return (
    <div className={styles.endorsement}>
      <div className={styles.controlsRow}>
        <div className={styles.tabs} role="tablist" aria-label="Relief request type">
          <span className={kind === "individual" ? styles.tabIndicatorRight : styles.tabIndicator} />
          <button type="button" role="tab" aria-selected={kind === "family"} onClick={() => setKind("family")}>Family Head Requests</button>
          <button type="button" role="tab" aria-selected={kind === "individual"} onClick={() => setKind("individual")}>Individual Requests</button>
        </div>
        <section className={styles.filterBar} aria-label="Request filters">
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All Status</option><option value="pending">Pending</option><option value="endorsed">Endorsed</option><option value="rejected">Rejected</option></select></label>
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <input type="search" aria-label="Search requests" placeholder="Search by resident or reference..." value={search} onChange={(event) => setSearch(event.target.value)} />
          {hasFilters ? <button className={styles.clearFilters} type="button" onClick={clearFilters}>Clear Filters</button> : null}
        </section>
      </div>
      <div className={styles.emptyCard}>
        <EmptyState title={hasFilters ? "No requests match your filters" : `No ${kind} relief requests available`} description={hasFilters ? "Try changing or clearing the status, date, or search filters." : "Resident relief requests will appear here when they are submitted through the mobile application."} actionLabel={hasFilters ? "Clear Filters" : undefined} onAction={hasFilters ? clearFilters : undefined} />
      </div>
    </div>
  );
}
