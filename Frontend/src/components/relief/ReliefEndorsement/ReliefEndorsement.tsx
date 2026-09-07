"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getCurrentUser, normalizeUserRole } from "@/lib/authSession";
import { endorseResidentReliefRequest, getResidentReliefRequests, reviewResidentReliefRequest } from "@/services/reliefService";
import type { ResidentReliefRequest } from "@/types/relief";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal/Modal";
import styles from "./ReliefEndorsement.module.css";

export function ReliefEndorsement() {
  const role = normalizeUserRole(getCurrentUser());
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<"all" | "family" | "individual">("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ResidentReliefRequest | null>(null);
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [releaseDate, setReleaseDate] = useState("");
  const [releaseTime, setReleaseTime] = useState("");
  const [releaseDetails, setReleaseDetails] = useState("");
  const [feedback, setFeedback] = useState("");
  const [mutationError, setMutationError] = useState("");
  const query = useQuery({ queryKey: ["relief-requests"], queryFn: getResidentReliefRequests });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Select a request first.");
      if (role === "barangay") return endorseResidentReliefRequest(selected.id);
      if (!action) throw new Error("Choose approve or reject.");
      if (action === "approve") return reviewResidentReliefRequest(selected.id, { action, release_date: releaseDate, release_time: releaseTime, release_details: releaseDetails });
      return reviewResidentReliefRequest(selected.id, { action, rejection_feedback: feedback });
    },
    onSuccess: async () => { setSelected(null); setAction(null); setMutationError(""); await queryClient.invalidateQueries({ queryKey: ["relief-requests"] }); },
    onError: (error) => setMutationError(error instanceof Error ? error.message : "Unable to update the request."),
  });
  const rows = useMemo(() => (query.data ?? []).filter((request) => {
    const searchable = `${request.full_name} ${request.family_name ?? ""} ${request.relief_type} ${request.reason} ${request.resident?.barangay_name ?? ""}`.toLowerCase();
    return (kind === "all" || request.request_kind === kind) && (status === "all" || request.status === status) && (!search.trim() || searchable.includes(search.trim().toLowerCase()));
  }), [kind, query.data, search, status]);

  function openRequest(request: ResidentReliefRequest) {
    setSelected(request); setAction(null); setMutationError(""); setReleaseDate(request.release_date ?? ""); setReleaseTime(request.release_time ?? ""); setReleaseDetails(request.release_details ?? ""); setFeedback(request.rejection_feedback ?? "");
  }

  return <div className={styles.endorsement}>
    <div className={styles.controlsRow}>
      <div className={styles.tabs} role="tablist" aria-label="Relief request type">
        <span className={kind === "individual" ? styles.tabIndicatorRight : styles.tabIndicator} />
        <button type="button" role="tab" aria-selected={kind !== "individual"} onClick={() => setKind(kind === "family" ? "all" : "family")}>Family Requests</button>
        <button type="button" role="tab" aria-selected={kind === "individual"} onClick={() => setKind("individual")}>Individual Requests</button>
      </div>
      <section className={styles.filterBar} aria-label="Request filters">
        <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All Status</option><option value="Pending">Pending</option><option value="Endorsed">Endorsed</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option></select></label>
        <span className={styles.roleHint}>{role === "barangay" ? "Assigned barangay" : "CSWDD queue"}</span>
        <input type="search" aria-label="Search requests" placeholder="Search by resident or request..." value={search} onChange={(event) => setSearch(event.target.value)} />
      </section>
    </div>
    {query.isPending ? <div className={styles.emptyCard}><p className={styles.message}>Loading resident relief requests...</p></div> : null}
    {query.error ? <div className={styles.emptyCard}><p className={styles.error} role="alert">{query.error instanceof Error ? query.error.message : "Unable to load resident relief requests."}</p></div> : null}
    {!query.isPending && !query.error && rows.length === 0 ? <div className={styles.emptyCard}><EmptyState title="No resident relief requests" description="Requests will appear here when they match this workflow and your authorization scope." /></div> : null}
    {rows.length > 0 ? <div className={styles.tableCard}><table><thead><tr><th>Resident / Family</th><th>Type</th><th>Relief</th><th>Barangay</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((request) => <tr key={request.id}><td><strong>{request.full_name}</strong><small>{request.family_name ?? "Individual request"}</small></td><td>{request.request_kind}</td><td>{request.relief_type}</td><td>{request.resident?.barangay_name ?? "-"}</td><td>{formatDate(request.created_at)}</td><td><span className={`${styles.badge} ${styles[`status${request.status}`] ?? ""}`}>{request.status}</span></td><td><button className={styles.viewButton} type="button" onClick={() => openRequest(request)}>View</button></td></tr>)}</tbody></table></div> : null}
    {selected ? <Modal isOpen labelledBy="relief-request-detail" onClose={() => setSelected(null)} size="md"><div className={styles.detail}><h2 id="relief-request-detail">Resident Relief Request</h2><dl><div><dt>Resident</dt><dd>{selected.full_name}</dd></div><div><dt>Request type</dt><dd>{selected.request_kind}</dd></div><div><dt>Relief type</dt><dd>{selected.relief_type}</dd></div><div><dt>Barangay</dt><dd>{selected.resident?.barangay_name ?? "-"}</dd></div><div><dt>Reason</dt><dd>{selected.reason}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div></dl>{selected.status === "Pending" && role === "barangay" ? <button className={styles.primaryButton} type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>Endorse to CSWDD</button> : null}{selected.status === "Endorsed" && (role === "cswdd" || role === "super") ? <div className={styles.review}><div className={styles.actionButtons}><button type="button" className={action === "approve" ? styles.selectedAction : ""} onClick={() => setAction("approve")}>Approve</button><button type="button" className={action === "reject" ? styles.selectedAction : ""} onClick={() => setAction("reject")}>Reject</button></div>{action === "approve" ? <><label>Release date<input type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} required /></label><label>Release time<input type="time" value={releaseTime} onChange={(event) => setReleaseTime(event.target.value)} required /></label><label>Release details<textarea value={releaseDetails} onChange={(event) => setReleaseDetails(event.target.value)} /></label></> : null}{action === "reject" ? <label>Rejection feedback<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} required /></label> : null}{action ? <button className={styles.primaryButton} type="button" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "Saving..." : `Confirm ${action}`}</button> : null}</div> : null}{mutationError ? <p className={styles.error} role="alert">{mutationError}</p> : null}</div></Modal> : null}
  </div>;
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString(); }
