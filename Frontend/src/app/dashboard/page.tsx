"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell, type AdminViewContext, type DashboardUserProfile } from "@/components/layout/AppShell/AppShell";
import type { DashboardPresentationView } from "@/components/layout/DashboardPresentationContext";
import { WeatherForecastPanel } from "@/components/weather/WeatherForecastPanel/WeatherForecastPanel";
import { NotificationPanel } from "@/components/notifications/NotificationPanel/NotificationPanel";
import { EmergencyReportPanel } from "@/components/emergency/EmergencyReportPanel/EmergencyReportPanel";
import { DashboardPanel } from "@/components/dashboard/DashboardPanel/DashboardPanel";
import { LogsPanel } from "@/components/logs/LogsPanel/LogsPanel";
import { SystemLogs } from "@/components/logs/SystemLogs/SystemLogs";
import { MonitoringPanel, type MonitoringView } from "@/components/monitoring/MonitoringPanel/MonitoringPanel";
import { ReliefPanel } from "@/components/relief/ReliefPanel/ReliefPanel";
import { ReliefManagementPanel } from "@/components/emergency/ReliefManagementPanel/ReliefManagementPanel";
import { BarangayReliefPanel } from "@/components/relief/BarangayReliefPanel/BarangayReliefPanel";
import { ReliefDistributionPanel } from "@/components/emergency/ReliefDistributionPanel/ReliefDistributionPanel";
import { SensorsPanel } from "@/components/sensors/SensorsPanel/SensorsPanel";
import { ResidentsPanel } from "@/components/residents/ResidentsPanel/ResidentsPanel";
import { VerificationPanel } from "@/components/verification/VerificationPanel/VerificationPanel";
import { navigationItemsForRole } from "@/data/navigation";
import { getCurrentUser, normalizeUserRole, profileForUser } from "@/lib/authSession";
import type { DashboardRole, PageKey } from "@/types/navigation";

const pageKeys: PageKey[] = [
  "dashboard",
  "logs",
  "systemLogs",
  "monitoring",
  "relief",
  "reliefManagement",
  "emergencyNotifications",
  "reliefDistribution",
  "sensors",
  "residents",
  "accounts",
];

function getPageFromHash(hash: string): PageKey {
  const value = hash.replace("#", "");
  if (value === "hardware" || value === "sensor-configuration") return "sensors";
  return pageKeys.includes(value as PageKey) ? (value as PageKey) : "dashboard";
}

type DashboardSession = {
  role: DashboardRole;
  profile: DashboardUserProfile;
};

export default function DashboardPage() {
  const [session, setSession] = useState<DashboardSession | null>(null);
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [presentationView, setPresentationView] = useState<DashboardPresentationView | null>(null);
  const [notificationRequest, setNotificationRequest] = useState<{ id: string; version: number } | null>(null);
  const [notificationVersion, setNotificationVersion] = useState(0);
  const [distributionView, setDistributionView] = useState<"distribution" | "history" | undefined>(undefined);
  const [monitoringView, setMonitoringView] = useState<MonitoringView>("main");
  const [monitoringResetVersion, setMonitoringResetVersion] = useState(0);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [adminView, setAdminView] = useState<AdminViewContext | null>(null);
  const navigationItems = useMemo(() => session ? navigationItemsForRole(session.role) : [], [session]);
  const allowedPages = useMemo(() => {
    const keys = navigationItems.map((item) => item.key);
    // Super-admin barangay groups expose the existing barangay emergency module
    // as a scoped destination even though it is not a primary super-admin item.
    if (session?.role === "super") keys.push("emergencyNotifications");
    // CSWDD opens the distribution list from the Relief Management landing card.
    // Keep it reachable without adding a duplicate primary sidebar item.
    if (session?.role === "cswdd") keys.push("reliefDistribution");
    return Array.from(new Set(keys));
  }, [navigationItems, session?.role]);
  useEffect(() => {
    setPresentationView(null);
    if (activePage !== "emergencyNotifications") setNotificationRequest(null);
  }, [activePage]);

  useEffect(() => {
    const user = getCurrentUser();
    const role = normalizeUserRole(user);

    if (!user || !role) {
      window.location.replace("/");
      return;
    }

    if (process.env.NODE_ENV === "development") {
      console.log("Current session user:", user);
      console.log("Normalized role:", role);
    }

    setSession({ role, profile: profileForUser(user, role) });
  }, []);

  useEffect(() => {
    if (!session) return;
    const pageFromHash = getPageFromHash(window.location.hash);
    setActivePage(allowedPages.includes(pageFromHash) ? pageFromHash : "dashboard");

    const handleHashChange = () => {
      const nextPage = getPageFromHash(window.location.hash);
      const allowedPage = allowedPages.includes(nextPage) ? nextPage : "dashboard";
      setActivePage(allowedPage);
      if (allowedPage === "monitoring") {
        setMonitoringView("main");
        setMonitoringResetVersion((version) => version + 1);
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [allowedPages, session]);

  useEffect(() => {
    if (!session) return;
    if (allowedPages.includes(activePage)) return;
    setActivePage("dashboard");
    window.history.replaceState(null, "", "#dashboard");
  }, [activePage, allowedPages, session]);

  function handleNavigate(page: PageKey, nextAdminView?: AdminViewContext) {
    const targetPage = allowedPages.includes(page) ? page : "dashboard";
    setActivePage(targetPage);
    setAdminView(nextAdminView ?? null);
    setMonitoringView("main");
    if (targetPage === "monitoring") {
      setMonitoringResetVersion((version) => version + 1);
    }
    setIsMobileNavOpen(false);
    window.history.replaceState(null, "", `#${targetPage}`);
  }

  function navigateFromPresentation(page: PageKey, nextAdminView?: AdminViewContext) {
    setPresentationView(null);
    setDistributionView(undefined);
    handleNavigate(page, nextAdminView);
  }

  function openAllocationNotification(id: string) {
    if (session?.role !== "barangay") return;
    const version = notificationVersion + 1;
    setNotificationVersion(version);
    setNotificationRequest({ id, version });
    navigateFromPresentation("emergencyNotifications");
  }

  function acknowledgeNotification(version: number) {
    setNotificationRequest((current) => current?.version === version ? null : current);
  }

  function openDistribution(view: "distribution" | "history") {
    navigateFromPresentation("reliefDistribution");
    setDistributionView(view);
  }

  if (!session) {
    return null;
  }

  return (
    <AppShell
      presentation={{ view: presentationView, open: (view) => { setPresentationView(view); setIsMobileNavOpen(false); } }}
      adminView={adminView}
      activePage={activePage}
      hideTopbar={activePage === "monitoring" && monitoringView !== "main"}
      isMobileNavOpen={isMobileNavOpen}
      navigationItems={navigationItems}
      onNavigate={navigateFromPresentation}
      onToggleMobileNav={() => setIsMobileNavOpen((isOpen) => !isOpen)}
      userProfile={session.profile}
      userRole={session.role}
    >
      <div hidden={presentationView !== null}>
      {activePage === "dashboard" ? <DashboardPanel /> : null}
      {activePage === "logs" ? <LogsPanel /> : null}
      {activePage === "systemLogs" ? <SystemLogs /> : null}
      {activePage === "monitoring" ? <MonitoringPanel resetSignal={monitoringResetVersion} onViewChange={setMonitoringView} userProfile={session.profile} /> : null}
      {activePage === "relief" ? <ReliefPanel onNavigate={navigateFromPresentation} /> : null}
      {activePage === "reliefManagement" ? <ReliefManagementPanel /> : null}
      {activePage === "emergencyNotifications" ? <BarangayReliefPanel barangayScope={adminView?.role === "barangay" ? adminView.label : session.profile.barangayName ?? undefined} notificationRequest={notificationRequest} onNotificationHandled={acknowledgeNotification} /> : null}
      {activePage === "reliefDistribution" ? <ReliefDistributionPanel initialView={distributionView} barangayScope={adminView?.role === "barangay" ? adminView.label : undefined} forceBarangayView={Boolean(adminView?.role === "barangay")} onBack={() => navigateFromPresentation(session.role === "barangay" ? "emergencyNotifications" : "relief")} /> : null}
      {activePage === "sensors" ? <SensorsPanel /> : null}
      {activePage === "residents" ? <ResidentsPanel barangayScope={adminView?.role === "barangay" ? adminView.label : undefined} /> : null}
      {activePage === "accounts" ? <VerificationPanel barangayScope={adminView?.role === "barangay" ? adminView.label : undefined} /> : null}
      </div>
      {presentationView === "weatherForecast" ? <WeatherForecastPanel onBack={() => setPresentationView(null)} /> : null}
      {presentationView === "notifications" ? <NotificationPanel role={session.role} onBack={() => setPresentationView(null)} onNavigate={navigateFromPresentation} onOpenAllocation={openAllocationNotification} /> : null}
      {presentationView === "emergencyReports" ? <EmergencyReportPanel barangayScope={adminView?.role === "barangay" ? adminView.label : undefined} /> : null}
    </AppShell>
  );
}
