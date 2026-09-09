"use client";

import { useEffect, useState } from "react";
import { EmergencyNotificationsPanel } from "@/components/emergency/EmergencyNotificationsPanel/EmergencyNotificationsPanel";
import { ReliefDistributionPanel } from "@/components/emergency/ReliefDistributionPanel/ReliefDistributionPanel";
import { ReliefEndorsement } from "@/components/relief/ReliefEndorsement/ReliefEndorsement";
import styles from "./BarangayReliefPanel.module.css";

export type BarangayReliefView = "main" | "allocation" | "distribution" | "history" | "endorsement";

const modules: Array<{ view: Exclude<BarangayReliefView, "main">; title: string; icon: string }> = [
  { view: "allocation", title: "Relief Allocation Notification", icon: "/images/dashboard/relief-allocation.svg" },
  { view: "distribution", title: "Relief Distribution", icon: "/images/dashboard/relief-distribution.svg" },
  { view: "history", title: "Relief Distribution History", icon: "/images/dashboard/relief-history.svg" },
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
        {view === "allocation" ? <EmergencyNotificationsPanel barangayScope={barangayScope} openRequest={notificationRequest} onOpenRequestHandled={onNotificationHandled} /> : null}
        {view === "distribution" ? <ReliefDistributionPanel mode="distribution" barangayScope={barangayScope} forceBarangayView={Boolean(barangayScope)} /> : null}
        {view === "history" ? <ReliefDistributionPanel mode="history" barangayScope={barangayScope} forceBarangayView={Boolean(barangayScope)} /> : null}
        {view === "endorsement" ? <ReliefEndorsement barangayScope={barangayScope} /> : null}
      </div>
    </section>
  );
}
