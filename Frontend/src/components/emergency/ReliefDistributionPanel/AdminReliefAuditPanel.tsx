"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Pagination as SharedPagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import { cn } from "@/lib/cn";
import { getCurrentUser, userDisplayName } from "@/lib/authSession";
import { downloadReliefHistoryReport } from "@/lib/reliefHistoryReport";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import {
  getReliefCampaignHistory,
  getReliefDistributionHistory,
  getReliefDistributionReport,
  getReliefNotReceived,
} from "@/services/emergencyService";
import type {
  Pagination,
  ReliefBarangayBreakdown,
  ReliefCampaign,
  ReliefDistributionRecord,
  ReliefNotReceivedBeneficiary,
  ReliefReportSummary,
} from "@/types/emergency";
import styles from "./ReliefDistributionPanel.module.css";

const pageSize = 5;

export function AdminReliefAuditPanel() {
  const [selectedCampaign, setSelectedCampaign] = useState<ReliefCampaign | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [notReceivedPage, setNotReceivedPage] = useState(1);
  const [barangayPage, setBarangayPage] = useState(1);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  const campaignsQuery = useQuery({
    queryKey: queryKeys.relief.campaigns,
    queryFn: getReliefCampaignHistory,
    staleTime: queryStaleTime.operational,
  });
  const campaigns = campaignsQuery.data ?? [];
  const selectedBatchId = selectedCampaign?.batch_id ?? "";
  const reportQuery = useQuery({
    queryKey: selectedBatchId ? queryKeys.relief.distributionReport(selectedBatchId) : ["relief", "distribution-report", "none"],
    queryFn: () => getReliefDistributionReport(selectedBatchId),
    staleTime: queryStaleTime.operational,
    enabled: Boolean(selectedBatchId),
  });
  const historyQuery = useQuery({
    queryKey: queryKeys.relief.distributionHistory(selectedBatchId, historyPage, pageSize),
    queryFn: () => getReliefDistributionHistory(selectedBatchId, historyPage, pageSize),
    staleTime: queryStaleTime.operational,
    enabled: Boolean(selectedBatchId),
  });
  const notReceivedQuery = useQuery({
    queryKey: selectedBatchId ? queryKeys.relief.notReceived(selectedBatchId, notReceivedPage, pageSize) : ["relief", "not-received", "none"],
    queryFn: () => getReliefNotReceived(selectedBatchId, notReceivedPage, pageSize),
    staleTime: queryStaleTime.operational,
    enabled: Boolean(selectedBatchId),
  });
  const summary = reportQuery.data?.summary ?? null;
  const barangays = reportQuery.data?.barangays ?? [];
  const history = historyQuery.data?.distributions ?? [];
  const historyPagination = historyQuery.data?.pagination ?? null;
  const notReceived = notReceivedQuery.data?.beneficiaries ?? [];
  const notReceivedPagination = notReceivedQuery.data?.pagination ?? null;
  const loadError = campaignsQuery.error ?? reportQuery.error ?? historyQuery.error ?? notReceivedQuery.error;
  const error = loadError instanceof Error ? loadError.message : loadError ? "Unable to load relief distribution audit data." : null;
  const loading = campaignsQuery.isPending
    ? "loading campaigns"
    : reportQuery.isPending && selectedBatchId
      ? "loading report"
      : "";
  const isBackgroundRefreshing = !loading && (campaignsQuery.isFetching || reportQuery.isFetching || historyQuery.isFetching || notReceivedQuery.isFetching);

  const activeCampaigns = useMemo(() => campaigns.filter((campaign) => campaign.status === "in_distribution"), [campaigns]);
  const notReadyCampaigns = useMemo(
    () => campaigns.filter((campaign) => ["accepted", "barangays_notified"].includes(campaign.status)),
    [campaigns],
  );
  const historicalCampaigns = useMemo(
    () => campaigns.filter((campaign) => ["completed", "closed", "expired"].includes(campaign.status)),
    [campaigns],
  );
  const paginatedBarangays = useMemo(() => {
    const limit = 5;
    const totalPages = Math.max(1, Math.ceil(barangays.length / limit));
    const page = Math.min(barangayPage, totalPages);
    return {
      rows: barangays.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: barangays.length, totalPages } satisfies PaginationState,
    };
  }, [barangays, barangayPage]);

  useEffect(() => {
    if (selectedCampaign && campaigns.some((campaign) => campaign.batch_id === selectedCampaign.batch_id)) return;
    setSelectedCampaign(campaigns.find((campaign) => campaign.status === "in_distribution") ?? campaigns[0] ?? null);
  }, [campaigns, selectedCampaign]);

  useEffect(() => {
    setHistoryPage(1);
    setNotReceivedPage(1);
    setBarangayPage(1);
  }, [selectedCampaign?.batch_id]);

  useEffect(() => {
    if (barangayPage !== paginatedBarangays.pagination.page) setBarangayPage(paginatedBarangays.pagination.page);
  }, [barangayPage, paginatedBarangays.pagination.page]);

  function selectCampaign(campaign: ReliefCampaign) {
    setSelectedCampaign(campaign);
    setIsSwitcherOpen(false);
  }

  async function exportCampaignReport() {
    if (!selectedCampaign) return;
    const allHistory = await fetchAllDistributionHistory(selectedCampaign.batch_id);
    downloadReliefHistoryReport({
      campaign: selectedCampaign,
      history: allHistory,
      summary,
      barangays,
      scopeLabel: "All Barangays",
      generatedBy: userDisplayName(getCurrentUser()) || undefined,
    });
  }

  return (
    <section className={styles.stack} aria-label="Relief distribution audit and reporting">
      <div className={styles.summary}>
        <div>
          <span>Administrative Relief Audit</span>
          <h3>{selectedCampaign?.plan_name ?? "No Relief Program Selected"}</h3>
          <p>Read-only campaign monitoring, coverage reporting, and historical distribution audit.</p>
        </div>
        <div className={styles.summaryAside}>
          <div className={styles.summaryStats}>
            <Metric label="Status" value={selectedCampaign ? formatStatus(selectedCampaign.status) : "-"} compact />
            <Metric label="Coverage" value={summary ? `${summary.coverage}%` : "-"} compact />
          </div>
          <button className={styles.switchButton} type="button" onClick={() => setIsSwitcherOpen(true)}>
            Switch Relief Program
          </button>
        </div>
      </div>

      {error ? <p className={styles.errorMessage}>{error}</p> : null}
      {loading ? <p className={styles.stateMessage}>{formatStatus(loading)}...</p> : null}
      {isBackgroundRefreshing ? <p className={styles.stateMessage}>Refreshing audit data...</p> : null}

      {selectedCampaign ? (
        <section className={cn(styles.card, styles.selectedCampaignCard)}>
          <header className={styles.cardHeader}>
            <span>Campaign Summary</span>
            <h3>{selectedCampaign.plan_name}</h3>
            <p>All figures are scoped to the selected relief campaign batch.</p>
          </header>
          <dl className={styles.details}>
            <Detail label="Strategy" value={formatStatus(selectedCampaign.plan_id)} />
            <Detail label="Status" value={formatStatus(selectedCampaign.status)} />
            <Detail label="Started" value={formatDate(selectedCampaign.started_at ?? selectedCampaign.accepted_at ?? selectedCampaign.created_at)} />
            <Detail label="Closed / Expiration" value={formatDate(selectedCampaign.closed_at ?? selectedCampaign.expires_at)} />
            <Detail label="Barangays" value={String(summary?.barangays ?? selectedCampaign.progress?.total_barangays ?? 0)} />
            <Detail label="Available" value={String(summary?.eligible ?? 0)} />
            <Detail label="Received" value={String(summary?.received ?? 0)} />
            <Detail label="Not Received" value={String(summary?.not_received ?? 0)} />
            <Detail label="Coverage" value={summary ? `${summary.coverage}%` : "0%"} />
          </dl>
          <div className={styles.actionRow}>
            <button className={styles.secondaryButton} type="button" onClick={exportCampaignReport}>
              Download History Report
            </button>
          </div>
        </section>
      ) : null}

      {selectedCampaign ? (
        <>
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <span>Campaign Breakdown</span>
              <h3>Barangay Coverage</h3>
              <p>Available, received, and not-yet-served counts for this selected batch.</p>
            </header>
            <div className={styles.tableWrap}>
              <table className={styles.reportTable}>
                <thead>
                  <tr>
                    <th>Barangay</th>
                    <th>Available</th>
                    <th>Received</th>
                    <th>Not Received</th>
                    <th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {barangays.length === 0 ? (
                    <tr><td colSpan={5}>No barangay availability data for this campaign yet.</td></tr>
                  ) : paginatedBarangays.rows.map((row) => (
                    <tr key={row.barangay_id}>
                      <td>{row.barangay_name}</td>
                      <td>{row.eligible}</td>
                      <td>{row.received}</td>
                      <td>{row.not_received}</td>
                      <td>{row.coverage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SharedPagination pagination={paginatedBarangays.pagination} onPageChange={setBarangayPage} label="Barangay coverage" />
          </section>

          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <span>Campaign Records</span>
              <h3>Distribution History</h3>
              <p>Confirmed receipt records for this selected campaign only.</p>
            </header>
            <RecordList records={history} />
            <SharedPagination pagination={historyPagination} onPageChange={setHistoryPage} label="Distribution history" />
          </section>

          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <span>Campaign Availability</span>
              <h3>Beneficiaries Not Yet Served</h3>
              <p>Families notified for this campaign with no matching receipt record for this batch.</p>
            </header>
            <NotReceivedList records={notReceived} />
            <SharedPagination pagination={notReceivedPagination} onPageChange={setNotReceivedPage} label="Not-received beneficiaries" />
          </section>
        </>
      ) : (
        <section className={styles.card}>
          <div className={styles.emptyState}>Select a relief program to inspect campaign audit records.</div>
        </section>
      )}

      <Modal
        className={styles.switcherDialog}
        isOpen={isSwitcherOpen}
        labelledBy="admin-relief-campaign-switcher-title"
        onClose={() => setIsSwitcherOpen(false)}
        size="xl"
      >
        <header className={styles.switcherHeader}>
          <div>
            <span>Relief Program Switcher</span>
            <h3 id="admin-relief-campaign-switcher-title">Switch Relief Program</h3>
            <p>Select any campaign to open its read-only audit and reporting view.</p>
          </div>
          <button type="button" onClick={() => setIsSwitcherOpen(false)} aria-label="Close campaign switcher">
            x
          </button>
        </header>
        <div className={styles.switcherBody}>
          <CampaignGroup actionLabel="Open Audit" campaigns={activeCampaigns} emptyText="No campaigns are currently in distribution." label="Active" onSelect={selectCampaign} selectedBatchId={selectedCampaign?.batch_id ?? null} />
          <CampaignGroup actionLabel="View Status" campaigns={notReadyCampaigns} emptyText="No accepted or notified campaigns are waiting." label="Not Ready" onSelect={selectCampaign} selectedBatchId={selectedCampaign?.batch_id ?? null} />
          <CampaignGroup actionLabel="View Records" campaigns={historicalCampaigns} emptyText="No completed, closed, or expired campaign history yet." label="History" onSelect={selectCampaign} selectedBatchId={selectedCampaign?.batch_id ?? null} />
        </div>
      </Modal>
    </section>
  );
}

function CampaignGroup({ actionLabel, campaigns, emptyText, label, onSelect, selectedBatchId }: {
  actionLabel: string;
  campaigns: ReliefCampaign[];
  emptyText: string;
  label: string;
  onSelect: (campaign: ReliefCampaign) => void;
  selectedBatchId: string | null;
}) {
  const pageSize = 5;
  const [page, setPage] = useState(1);
  const paginatedCampaigns = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(campaigns.length / pageSize));
    const safePage = Math.min(page, totalPages);
    return {
      rows: campaigns.slice((safePage - 1) * pageSize, safePage * pageSize),
      pagination: { page: safePage, limit: pageSize, total: campaigns.length, totalPages } satisfies PaginationState,
    };
  }, [campaigns, page]);

  useEffect(() => {
    setPage(1);
  }, [campaigns]);

  useEffect(() => {
    if (page !== paginatedCampaigns.pagination.page) setPage(paginatedCampaigns.pagination.page);
  }, [page, paginatedCampaigns.pagination.page]);

  return (
    <div className={styles.campaignGroup}>
      <h4>{label}</h4>
      {campaigns.length === 0 ? <p className={styles.emptyState}>{emptyText}</p> : paginatedCampaigns.rows.map((campaign) => (
        <button className={cn(styles.campaignButton, selectedBatchId === campaign.batch_id && styles.selectedCampaignButton)} key={campaign.batch_id} type="button" onClick={() => onSelect(campaign)}>
          <span>{campaign.plan_name}</span>
          <strong>{formatStatus(campaign.status)}</strong>
          <small>{campaignTiming(campaign)}</small>
          <small>{campaign.progress?.total_distributions ?? 0} received</small>
          <em>{campaignReadinessCopy(campaign.status)}</em>
          <b>{actionLabel}</b>
        </button>
      ))}
      <SharedPagination pagination={paginatedCampaigns.pagination} onPageChange={setPage} label={`${label} campaigns`} />
    </div>
  );
}

function RecordList({ records }: { records: ReliefDistributionRecord[] }) {
  if (records.length === 0) return <div className={styles.emptyState}>No confirmed relief distributions for this campaign page.</div>;
  return (
    <div className={styles.historyList}>
      {records.map((record) => (
        <article key={record.distribution_id}>
          <div>
            <strong>{record.family_name ?? "Family"}</strong>
            <span>{record.family_head_name ?? "Family head not recorded"} • {record.barangay_name ?? `Barangay ${record.barangay_id}`} • {formatStatus(record.status)}</span>
          </div>
          <time>{formatDate(record.verified_at)}</time>
        </article>
      ))}
    </div>
  );
}

function NotReceivedList({ records }: { records: ReliefNotReceivedBeneficiary[] }) {
  if (records.length === 0) return <div className={styles.emptyState}>No beneficiaries are pending service on this campaign page.</div>;
  return (
    <div className={styles.historyList}>
      {records.map((record) => (
        <article key={record.family_id}>
          <div>
            <strong>{record.family_name}</strong>
            <span>{record.family_head_name ?? "Family head not recorded"} • {record.barangay_name} • {record.eligibility}</span>
          </div>
          <time>{record.distribution_status}</time>
        </article>
      ))}
    </div>
  );
}

async function fetchAllDistributionHistory(batchId: string) {
  const limit = 100;
  const firstPage = await getReliefDistributionHistory(batchId, 1, limit);
  const rows = [...firstPage.distributions];
  const totalPages = firstPage.pagination?.totalPages ?? 1;

  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await getReliefDistributionHistory(batchId, page, limit);
    rows.push(...nextPage.distributions);
  }

  return rows;
}


function Metric({ compact = false, label, value }: { compact?: boolean; label: string; value: number | string }) {
  return (
    <div className={cn(styles.metric, compact && styles.compactMetric)}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function campaignTiming(campaign: ReliefCampaign) {
  if (campaign.status === "in_distribution") return `Started ${formatDate(campaign.started_at ?? campaign.accepted_at ?? campaign.created_at)}`;
  if (campaign.status === "closed") return `Closed ${formatDate(campaign.closed_at)}`;
  if (campaign.status === "expired") return `Expired ${formatDate(campaign.expires_at)}`;
  if (campaign.status === "completed") return `Completed ${formatDate(campaign.closed_at ?? campaign.expires_at)}`;
  return `Created ${formatDate(campaign.created_at)}`;
}

function campaignReadinessCopy(status: string) {
  if (status === "in_distribution") return "Open for administrative monitoring.";
  if (status === "accepted") return "Distribution has not started yet.";
  if (status === "barangays_notified") return "Barangay and family-head preparation is still in progress.";
  return "Read-only historical campaign records.";
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatus(value?: string | null) {
  const text = String(value ?? "").replace(/_/g, " ").trim();
  return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : "Unknown";
}
