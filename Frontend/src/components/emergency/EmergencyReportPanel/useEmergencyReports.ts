"use client";
import { useEffect, useRef, useState } from "react";
import { advanceIncident, getIncident, getIncidentList } from "@/services/emergencyIncidentService";
import { incidentPresentation, incidentStatusForLabel } from "@/adapters/emergencyIncidentPresentation";
import type { IncidentList } from "@/types/emergencyIncident";
import type { EmergencyReportPresentationProps, EmergencyReportViewModel } from "./EmergencyReportPanel";
import { barangayIdForName } from "@/lib/barangayScope";
const message = (error: unknown) => error instanceof Error ? error.message : "Unable to load emergency reports.";
export function useEmergencyReports(barangayScope?: string): EmergencyReportPresentationProps {
  const barangayId = barangayIdForName(barangayScope);
  const [view, setView] = useState<EmergencyReportPresentationProps["view"]>("main");
  const [status, setStatus] = useState<EmergencyReportPresentationProps["statusFilter"]>("Pending");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<IncidentList | null>(null);
  const [state, setState] = useState<EmergencyReportPresentationProps["state"]>("loading");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<EmergencyReportViewModel | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [confirmed, setConfirmed] = useState<EmergencyReportPresentationProps["confirmedUpdate"]>(null);
  const detailRequest = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; detailRequest.current++; }; }, []);
  useEffect(() => { const timer = setTimeout(() => { setSearch(query); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    if (view === "main") return;
    let cancelled = false;
    setState("loading"); setError("");
    getIncidentList(view === "history" ? "resolved" : incidentStatusForLabel[status], search, page, barangayId).then(result => {
      if (cancelled) return;
      if (page > 1 && result.reports.length === 0) { setPage(Math.max(1, result.pagination.total_pages)); return; }
      setData(result); setState("ready");
    }).catch(error => { if (!cancelled) { setError(message(error)); setState("error"); } });
    return () => { cancelled = true; };
  }, [view, status, search, page, refresh, barangayId]);
  // Refresh persisted reports when mobile submission/confirmation happens outside this page.
  useEffect(() => {
    if (view === "main") return;
    const refreshData = () => { if (document.visibilityState === "visible") setRefresh(n => n + 1); };
    const timer = setInterval(refreshData, 30000);
    window.addEventListener("focus", refreshData);
    return () => { clearInterval(timer); window.removeEventListener("focus", refreshData); };
  }, [view]);
  useEffect(() => {
    if (!selected || updating) return;
    let cancelled = false;
    const ticket = detailRequest.current;
    getIncident(selected.id, barangayId).then(result => {
      if (!cancelled && ticket === detailRequest.current) setSelected(incidentPresentation(result, barangayId));
    }).catch(error => { if (!cancelled && ticket === detailRequest.current) setUpdateError(message(error)); });
    return () => { cancelled = true; };
  }, [refresh, selected?.id, updating, barangayId]);
  const close = () => { detailRequest.current++; setSelected(null); setConfirmed(null); setUpdateError(""); };
  return {
    view, state, statusFilter: status, query,
    onViewChange(next) { close(); setView(next); setQuery(""); setSearch(""); setStatus("Pending"); setPage(1); },
    onStatusFilterChange(next) { setStatus(next); setPage(1); },
    onQueryChange: setQuery, onPageChange: setPage,
    reports: data?.reports.map(incidentPresentation),
    statusCounts: data ? { Pending: data.counts.pending, "En Route": data.counts.en_route, Arrived: data.counts.arrived } : undefined,
    pagination: data ? { ...data.pagination, totalPages: data.pagination.total_pages } : null,
    selectedReport: selected, onCloseReport: close, errorMessage: error,
    onRetry: () => setRefresh(n => n + 1),
    async onSelectReport(report) {
      const ticket = ++detailRequest.current;
      setConfirmed(null); setUpdateError("");
      try { const result = await getIncident(report.id, barangayId); if (mounted.current && ticket === detailRequest.current) setSelected(incidentPresentation(result, barangayId)); }
      catch (error) { if (mounted.current && ticket === detailRequest.current) { setError(message(error)); setState("error"); } }
    },
    isUpdating: updating, updateError, confirmedUpdate: confirmed, onDismissUpdate: () => setConfirmed(null),
    async onAdvance(report, next) {
      if (updating) return;
      const ticket = detailRequest.current;
      setUpdating(true); setUpdateError(""); setConfirmed(null);
      try {
        const result = await advanceIncident(report.id, next === "En Route" ? "en_route" : "arrived", barangayId);
        if (!mounted.current) return;
        if (ticket === detailRequest.current) {
          setSelected(incidentPresentation(result, barangayId));
          const label = result.status === "en_route" ? "En Route" : result.status === "arrived" ? "Arrived" : null;
          if (label) setConfirmed({ status: label, message: label === "En Route" ? "You are now en route to the location." : "You have arrived at the location." });
        }
        setStatus(next); setPage(1); setRefresh(n => n + 1);
      } catch (error) {
        if (mounted.current && ticket === detailRequest.current) setUpdateError(message(error));
      } finally { if (mounted.current) setUpdating(false); }
    },
  };
}
