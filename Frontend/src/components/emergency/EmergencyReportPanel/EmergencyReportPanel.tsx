"use client";

import { useState } from "react";
import { useEmergencyReports } from "./useEmergencyReports";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal/Modal";
import { Pagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import styles from "./EmergencyReportPanel.module.css";

type View = "main" | "reports" | "history";
export type EmergencyReportStatus = "Pending" | "En Route" | "Arrived" | "Resolved";
type ActiveStatus = Exclude<EmergencyReportStatus, "Resolved">;
type DataState = "unavailable" | "loading" | "error" | "ready";

/** Presentation model; API fields are mapped in emergencyIncidentPresentation.ts. */
export interface EmergencyReportViewModel {
  id: string;
  residentName: string | null;
  location: string | null;
  phone: string | null;
  submittedAtLabel: string | null;
  description: string | null;
  status: EmergencyReportStatus;
  photos: readonly { id: string; url: string; description: string }[];
  residentConfirmation?: { message: string | null; confirmedAtLabel: string | null } | null;
}

export interface EmergencyReportPresentationProps {
  view: View;
  onViewChange: (view: View) => void;
  state: DataState;
  statusFilter: ActiveStatus;
  onStatusFilterChange: (status: ActiveStatus) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Already scoped and paginated by a authorized controller. Never seed this with prototype data. */
  reports?: readonly EmergencyReportViewModel[];
  statusCounts?: Readonly<Partial<Record<ActiveStatus, number>>>;
  pagination?: PaginationState | null;
  onPageChange?: (page: number) => void;
  selectedReport?: EmergencyReportViewModel | null;
  onSelectReport?: (report: EmergencyReportViewModel) => void;
  onCloseReport?: () => void;
  errorMessage?: string;
  onRetry?: () => void;
  /** Supply only after a real, authorized status-update capability is integrated. */
  onAdvance?: (report: EmergencyReportViewModel, nextStatus: "En Route" | "Arrived") => void;
  isUpdating?: boolean;
  updateError?: string;
  /** Controlled acknowledgement of a persisted update; the view never creates a success result. */
  confirmedUpdate?: { status: "En Route" | "Arrived"; message: string } | null;
  onDismissUpdate?: () => void;
}

/** Connect the existing REY presentation through a typed API controller. */
export function EmergencyReportPanel({ barangayScope }: { barangayScope?: string } = {}) {
  const props = useEmergencyReports(barangayScope);
  return <EmergencyReportPresentation {...props} />;
}

/** REY composition, with controlled report data and persistence supplied from outside the view. */
export function EmergencyReportPresentation({
  view, onViewChange, state, statusFilter, onStatusFilterChange, query, onQueryChange,
  reports = [], statusCounts, pagination, onPageChange, selectedReport, onSelectReport,
  onCloseReport, errorMessage, onRetry, onAdvance, isUpdating = false, updateError,
  confirmedUpdate, onDismissUpdate,
}: EmergencyReportPresentationProps) {
  const isHistory = view === "history";
  const canRead = state === "ready";

  if (view === "main") return (
    <section aria-label="Resident emergency reports">
      <div className={styles.cards} aria-label="Emergency report management modules">
        <button type="button" onClick={() => onViewChange("reports")}><span><AlertIcon /></span><strong>Emergency Report</strong><p>View real-time emergency report from the residents</p></button>
        <button type="button" onClick={() => onViewChange("history")}><span><HistoryIcon /></span><strong>Emergency Report History</strong><p>View tabulated emergency report history records</p></button>
      </div>
      {state === "unavailable" ? <UnavailableNotice /> : null}
    </section>
  );

  return (
    <section className={styles.page} aria-label={isHistory ? "Emergency report history" : "Emergency reports"} aria-busy={state === "loading"}>
      <button className={styles.back} type="button" onClick={() => onViewChange("main")}>← Back</button>
      <h1>{isHistory ? "Emergency Report History" : "Emergency Report"}</h1>
      {!isHistory ? <div className={styles.statusTabs} role="tablist" aria-label="Emergency report status">
        {(["Pending", "En Route", "Arrived"] as const).map((status) => <button
          key={status} type="button" role="tab" aria-selected={statusFilter === status}
          disabled={!canRead} onClick={() => onStatusFilterChange(status)}
        >
          <span className={styles.statusTabIcon} aria-hidden="true">{status === "Pending" ? "◷" : status === "En Route" ? "→" : "✓"}</span>
          {status}<small aria-label={statusCounts?.[status] === undefined ? `${status} count unavailable` : `${statusCounts[status]} ${status} reports`}>{canRead ? statusCounts?.[status] ?? "—" : "—"}</small>
        </button>)}
      </div> : null}
      <div className={styles.searchBar}><label><SearchIcon /><input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} disabled={state === "unavailable"} placeholder="Search" aria-label="Search emergency reports" /></label></div>
      <div className={styles.tableWrap}>
        <table><thead><tr><th scope="col">Name</th><th scope="col">Location</th><th scope="col">Phone Number</th><th scope="col">Status</th><th scope="col"><span className={styles.srOnly}>Actions</span></th></tr></thead>
          <tbody>{canRead ? reports.map((report) => <tr key={report.id}>
            <td>{report.residentName ?? "Not provided"}</td><td>{report.location ?? "Not provided"}</td><td>{report.phone ?? "Not provided"}</td>
            <td><span className={styles[statusClass(report.status)]}>{report.status}</span></td>
            <td><button className={styles.details} type="button" disabled={!onSelectReport} onClick={() => onSelectReport?.(report)}><EyeIcon />Details</button></td>
          </tr>) : null}</tbody>
        </table>
        {state === "unavailable" ? <UnavailableNotice history={isHistory} /> : null}
        {state === "loading" ? <div className={styles.loadingState} role="status"><span className={styles.loadingRing} aria-hidden="true" />Loading emergency {isHistory ? "history" : "reports"}…</div> : null}
        {state === "error" ? <EmptyState title="Unable to load emergency reports" description={errorMessage ?? "Please try again."} actionLabel={onRetry ? "Try again" : undefined} onAction={onRetry} /> : null}
        {canRead && reports.length === 0 ? <EmptyState
          searchResult={Boolean(query)}
          title={query ? "No emergency reports match your search" : `No emergency ${isHistory ? "report history records" : "reports"} available`}
          description={query ? "We couldn’t find any emergency reports matching your search." : "Emergency reports will appear here when they become available."}
        /> : null}
      </div>
      {canRead && onPageChange ? <Pagination pagination={pagination ?? null} onPageChange={onPageChange} label="Emergency reports" /> : null}
      <Modal isOpen={Boolean(selectedReport)} onClose={() => onCloseReport?.()} labelledBy="emergency-report-detail-title" className={styles.dialog} backdropClassName={styles.overlay} size="xl">
        {selectedReport ? <EmergencyReportDetails key={selectedReport.id} report={selectedReport} onClose={() => onCloseReport?.()} onAdvance={onAdvance} isUpdating={isUpdating} updateError={updateError} confirmedUpdate={confirmedUpdate} onDismissUpdate={onDismissUpdate} /> : null}
      </Modal>
    </section>
  );
}

export function EmergencyReportDetails({ report, onClose, onAdvance, isUpdating = false, updateError, confirmedUpdate, onDismissUpdate }: {
  report: EmergencyReportViewModel;
  onClose: () => void;
  onAdvance?: EmergencyReportPresentationProps["onAdvance"];
  isUpdating?: boolean;
  updateError?: string;
  confirmedUpdate?: EmergencyReportPresentationProps["confirmedUpdate"];
  onDismissUpdate?: () => void;
}) {
  const nextStatus = report.status === "Pending" ? "En Route" : report.status === "En Route" ? "Arrived" : null;

  return <>
    {confirmedUpdate ? <div className={styles.toast} role="status"><b aria-hidden="true">✓</b><span><strong>{confirmedUpdate.status}</strong><small>{confirmedUpdate.message}</small></span>{onDismissUpdate ? <button className={styles.dismissToast} type="button" onClick={onDismissUpdate} aria-label="Dismiss status update">×</button> : null}</div> : null}
    <button className={styles.close} type="button" onClick={onClose} aria-label="Close emergency report">×</button>
    <header><span className={styles.avatar}><UserIcon /></span><div><h2 id="emergency-report-detail-title">{report.residentName ?? "Resident name unavailable"}</h2><p>{report.submittedAtLabel ?? "Submission time unavailable"}</p></div></header>
    <div className={styles.contact}><p><span className={styles.contactIcon}><PinIcon /></span><span>{report.location ?? "Location unavailable"}</span></p><p><span className={styles.contactIcon}><PhoneIcon /></span>{report.phone ?? "Phone number unavailable"}</p></div>
    <div className={styles.message}>{report.description ? report.description.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p>No additional notes provided.</p>}</div>
    <EvidenceCarousel photos={report.photos} />
    {nextStatus ? <>
      <button className={styles.advance} data-status={report.status} type="button" disabled={!onAdvance || isUpdating} aria-describedby={!onAdvance ? "emergency-status-unavailable" : undefined} onClick={() => onAdvance?.(report, nextStatus)}>{isUpdating ? "Updating status…" : `Mark as ${nextStatus}`}</button>
      {!onAdvance ? <p className={styles.capabilityNote} id="emergency-status-unavailable">Response status updates are unavailable.</p> : null}
    </> : null}
    {updateError ? <p className={styles.updateError} role="alert">{updateError}</p> : null}
    {report.status === "Arrived" ? <p className={styles.awaitingResolution}>Awaiting the resident to confirm that this emergency has been resolved.</p> : null}
    {report.status === "Resolved" ? report.residentConfirmation ? <blockquote>{report.residentConfirmation.message ? <p>{report.residentConfirmation.message}</p> : <p>The resident confirmed that the emergency has been resolved.</p>}{report.residentConfirmation.confirmedAtLabel ? <footer>{report.residentConfirmation.confirmedAtLabel}</footer> : null}</blockquote> : <p className={styles.capabilityNote}>Resident confirmation details are unavailable.</p> : null}
  </>;
}

export function EvidenceCarousel({ photos }: { photos: EmergencyReportViewModel["photos"] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set());
  const safeIndex = Math.min(activeIndex, Math.max(0, photos.length - 1));
  const photo = photos[safeIndex];
  const failed = photo ? failedUrls.has(photo.url) : false;

  function markUnavailable(url: string) { setFailedUrls((current) => new Set([...current, url])); }

  return <section className={styles.carousel} aria-label="Emergency report evidence photos">
    <div className={styles.carouselMain}>
      {photo && !failed ? <a href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.description || `Report photo ${safeIndex + 1}`} onError={() => markUnavailable(photo.url)} /></a> : <p className={styles.photoUnavailable}>{photo ? "This photo is unavailable." : "No report photos available."}</p>}
      {photos.length > 1 ? <><button className={styles.carouselPrev} type="button" onClick={() => setActiveIndex((safeIndex - 1 + photos.length) % photos.length)} aria-label="Previous report photo">‹</button><button className={styles.carouselNext} type="button" onClick={() => setActiveIndex((safeIndex + 1) % photos.length)} aria-label="Next report photo">›</button></> : null}
      {photo ? <span aria-live="polite">{safeIndex + 1} / {photos.length}</span> : null}
    </div>
    {photos.length > 1 ? <div className={styles.thumbnails}>{photos.map((item, index) => <button key={item.id} className={index === safeIndex ? styles.activeThumb : undefined} type="button" onClick={() => setActiveIndex(index)} aria-label={`View report photo ${index + 1}`} aria-pressed={index === safeIndex}>{failedUrls.has(item.url) ? <span className={styles.failedThumbnail}>Unavailable</span> : <img src={item.url} alt="" onError={() => markUnavailable(item.url)} />}</button>)}</div> : null}
  </section>;
}

function UnavailableNotice({ history = false }: { history?: boolean }) {
  return <div className={styles.unavailableNotice} role="status"><strong>{history ? "Emergency report history is unavailable" : "Emergency reporting is unavailable"}</strong><p>{history ? "Resolved reports and resident confirmations are not available yet." : "Resident reports, photos, and response status updates are not available yet."}</p></div>;
}

const statusClass = (status: EmergencyReportStatus) => status.toLowerCase().replace(" ", "");
function SearchIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>; }
function EyeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>; }
function PhoneIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></svg>; }
function UserIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-5 3.5-7 8-7s7.2 2 8 7" /></svg>; }
function AlertIcon() { return <svg viewBox="0 0 44 44" aria-hidden="true"><path d="M22 16.5v9.2M22 39.3H10.9c-6.4 0-9-4.6-6-10.1L16.1 9.2c3.2-5.9 8.6-5.9 11.8 0l11.2 20c3 5.5.4 10.1-6 10.1H22Z" /><path d="M22 31.2h.01" /></svg>; }
function HistoryIcon() { return <svg viewBox="0 0 44 44" aria-hidden="true"><path d="M23.8 27.5h-11l3.7 3.7m-3.7-3.7 3.7-3.7M40.3 18.3v9.2c0 9.2-3.6 12.8-12.8 12.8h-11c-9.2 0-12.8-3.6-12.8-12.8v-11c0-9.2 3.6-12.8 12.8-12.8h9.2" /><path d="M40.3 18.3H33c-5.5 0-7.3-1.8-7.3-7.3V3.7L40.3 18.3Z" /></svg>; }
