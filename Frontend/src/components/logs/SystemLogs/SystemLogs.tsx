"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Pagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import { getCurrentUser, logLabelForRole, normalizeUserRole } from "@/lib/authSession";
import { cn } from "@/lib/cn";
import { formatBarangayName, normalizeBarangayForCompare } from "@/lib/formatters";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import { getAuditLogs } from "@/services/logsService";
import type { AuditLog } from "@/types/logs";
import styles from "./SystemLogs.module.css";

export function SystemLogs() {
  const pageSize = 5;
  const [query, setQuery] = useState("");
  const [officeFilter, setOfficeFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [previewLog, setPreviewLog] = useState<AuditLog | null>(null);
  const [page, setPage] = useState(1);
  const user = getCurrentUser();
  const role = normalizeUserRole(user) ?? "barangay";
  const title = logLabelForRole(role, user);
  const emptyMessage = role === "cswdd" ? "No CSWDD logs found." : "No logs available for your role or assigned barangay.";
  const logsQuery = useQuery({
    queryKey: queryKeys.logs.audit,
    queryFn: getAuditLogs,
    staleTime: queryStaleTime.logs,
  });
  const logsSource = useMemo(() => (logsQuery.data ?? []) as unknown as AuditLog[], [logsQuery.data]);
  const isLoading = logsQuery.isPending;
  const error = logsQuery.error instanceof Error ? logsQuery.error.message : logsQuery.error ? "Unable to load logs." : "";

  // /api/logs already applies the authenticated viewers RBAC/barangay scope.
  // Keep the client-side filters on that authorized dataset without re-scoping it
  // from a separately stored browser session that can be stale or incomplete.
  const authorizedLogs = logsSource;
  const officeOptions = useMemo(() => unique(authorizedLogs.map(officeForLog).filter(Boolean)), [authorizedLogs]);
  const moduleOptions = useMemo(() => unique(authorizedLogs.map((log) => canonicalModule(log.module))), [authorizedLogs]);

  const logs = useMemo(() => {
    const normalizedQuery = normalizeBarangayForCompare(query);
    return authorizedLogs.filter((log) => {
      const office = officeForLog(log);
      const module = canonicalModule(log.module);
      const searchable = [
        log.actor_name,
        log.actor_role,
        log.action,
        module,
        office,
        log.description,
        log.barangay_name,
        log.created_at,
      ].join(" ");
      const matchesQuery = !normalizedQuery || normalizeBarangayForCompare(searchable).includes(normalizedQuery);
      return matchesQuery
        && (!officeFilter || office === officeFilter)
        && (!moduleFilter || module === moduleFilter);
    });
  }, [authorizedLogs, moduleFilter, officeFilter, query]);

  const paginatedLogs = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(logs.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    return {
      rows: logs.slice(start, start + pageSize),
      pagination: { page: safePage, limit: pageSize, total: logs.length, totalPages } satisfies PaginationState,
    };
  }, [logs, page]);

  useEffect(() => {
    setPage(1);
  }, [moduleFilter, officeFilter, query]);

  useEffect(() => {
    if (page !== paginatedLogs.pagination.page) setPage(paginatedLogs.pagination.page);
  }, [page, paginatedLogs.pagination.page]);

  return (
    <section className={styles.panel} aria-label={title}>
      <h1>{title}</h1>
      <article className={styles.logCard}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span className={styles.searchIcon} />
            <input
              type="search"
              placeholder="Search logs by actor, office, action, module, or barangay..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select value={officeFilter} onChange={(event) => setOfficeFilter(event.target.value)} aria-label="Office">
            <option value="">All Offices</option>
            {officeOptions.map((office) => <option key={office} value={office}>{office}</option>)}
          </select>
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} aria-label="Module">
            <option value="">All Modules</option>
            {moduleOptions.map((module) => <option key={module} value={module}>{module}</option>)}
          </select>
        </div>

      {error ? <p className={styles.error}>{error}</p> : null}
      {logsQuery.isFetching && !logsQuery.isPending ? <p className={styles.error} role="status">Refreshing logs...</p> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Event</th>
              <th>Email</th>
              <th>Office</th>
              <th>Action</th>
              <th>Timestamp</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {paginatedLogs.rows.map((log) => (
              <tr key={log.log_id ?? `${log.created_at}-${log.action}`}>
                <td className={styles.event}>
                  <span className={cn(styles.action, styles[getActionTone(log.action)])}>{log.action}</span>
                </td>
                <td>{formatBarangayName(log.actor_name || "-")}</td>
                <td>{officeForLog(log) || "-"}</td>
                <td>{formatBarangayName(log.description || canonicalModule(log.module))}</td>
                <td>{formatDateTime(log.created_at ?? "")}</td>
                <td className={styles.previewCell}>
                  <button className={styles.previewButton} type="button" onClick={() => setPreviewLog(log)}>Preview</button>
                </td>
              </tr>
            ))}
            {isLoading ? (
              <tr>
                <td className={styles.empty} colSpan={6}>Loading logs...</td>
              </tr>
            ) : null}
            {!isLoading && logs.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={6}>{emptyMessage}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pagination pagination={paginatedLogs.pagination} onPageChange={setPage} label="Audit logs" />
      </article>

      <Modal isOpen={Boolean(previewLog)} onClose={() => setPreviewLog(null)} labelledBy="log-preview-title" className={styles.logDialog} backdropClassName={styles.logBackdrop} size="md">
        {previewLog ? (
          <>
            <header className={styles.modalHeader}>
              <div>
                <h3 id="log-preview-title">Log Details</h3>
                <p>Complete activity record</p>
              </div>
              <button type="button" onClick={() => setPreviewLog(null)} aria-label="Close log preview">x</button>
            </header>
            <div className={styles.modalBody}>
              <dl className={styles.detailGrid}>
                <Detail label="Date/Time" value={formatDateTime(previewLog.created_at ?? previewLog.timestamp ?? "")} />
                <Detail label="Actor" value={previewLog.actor_name || previewLog.user || "-"} />
                <Detail label="Role" value={previewLog.actor_role || "-"} />
                <Detail label="Action" value={previewLog.action} />
                <Detail label="Module" value={canonicalModule(previewLog.module)} />
                <Detail label="Barangay" value={previewLog.barangay_name || "-"} />
                {previewLog.status ? <Detail label="Status / Result" value={previewLog.status} /> : null}
                <Detail label="Description" value={previewLog.description || "-"} wide />
              </dl>
              {getMetadata(previewLog).length > 0 ? (
                <section className={styles.metadata} aria-label="Log metadata">
                  <h4>Metadata</h4>
                  <dl className={styles.detailGrid}>
                    {getMetadata(previewLog).map(([label, value]) => <Detail key={label} label={label} value={value} />)}
                  </dl>
                </section>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>
    </section>
  );
}

function Detail({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? styles.wideDetail : undefined}>
      <dt>{label}</dt>
      <dd>{formatBarangayName(value)}</dd>
    </div>
  );
}

function getMetadata(log: AuditLog): Array<[string, string]> {
  return [
    ["Log ID", log.log_id],
    ["Actor User ID", log.actor_user_id],
    ["Target Type", log.target_type],
    ["Target ID", log.target_id],
    ["Barangay ID", log.barangay_id],
    ["Category", log.category],
    ["Office", officeForLog(log)],
    ["IP Address", log.ipAddress],
  ].flatMap(([label, value]) => value == null || value === "" ? [] : [[String(label), String(value)]]);
}

function getActionTone(action: string) {
  const value = action.toUpperCase().replace(/[\s-]+/g, "_");

  if (
    value.includes("DELETE")
    || value.includes("REJECT")
    || value.includes("BLOCK")
    || value.includes("DISABLE")
    || value.includes("FAILED")
    || value.includes("ERROR")
  ) return "badgeDanger";

  if (
    value.includes("EDIT")
    || value.includes("UPDATE")
    || value.includes("CHANGE")
    || value.includes("REVIEW")
    || value.includes("MODIFY")
  ) return "badgeWarning";

  if (
    value.includes("LOGIN_SUCCESS")
    || value.includes("LOGOUT")
    || value.includes("CREATE")
    || value.includes("ADD")
    || value.includes("APPROVE")
    || value.includes("GENERATED")
    || value.includes("REGISTER")
    || value.includes("ENABLE")
  ) return "badgeSuccess";

  return "badgeNeutral";
}

const reliefManagementBarangay = 'Relief Management ' + String.fromCharCode(0x2013) + ' Barangay';

const canonicalModuleLabels: Record<string, string> = {
  "flood monitoring": "Flood Monitoring Module",
  monitoring: "Flood Monitoring Module",
  "alert level": "Alert Level Management",
  "alert level management": "Alert Level Management",
  "flood heatmap": "Flood Heatmap",
  "flood history": "Flood History",
  "sensor history": "Flood History",
  "account management": "Account Management",
  "ai-optimized relief recommendation": "AI-Optimized Relief Recommendation",
  "emergency relief management": reliefManagementBarangay,
  "emergency relief": reliefManagementBarangay,
  "emergency relief / distribution": "Relief Distribution List",
  "emergency / distribution": "Relief Distribution List",
  "emergency relief notification": "Relief Distribution List",
  "resident relief request endorsement": "Resident Relief Request Review",
  "resident information": "Resident Information / RBI",
  "resident account registration management": "Resident Account Registration Management",
  "emergency reports": "Emergency Report Management",
  "emergency report": "Emergency Report Management",
  "emergency report history": "Emergency Report History",
};

function canonicalModule(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unassigned";
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  return canonicalModuleLabels[key] ?? raw;
}

function officeForLog(log: AuditLog) {
  const explicitDepartment = String(log.department ?? "").trim();
  const source = [explicitDepartment, log.actor_role ?? "", log.module ?? ""].join(" ");
  if (/cswdd|city welfare/i.test(source)) return "CSWDD";
  if (log.barangay_name || /barangay/i.test(source)) return "Barangay";
  if (/cdrrmo|ndrrmo|command center/i.test(source)) return "CDRRMO Command Center";
  return "";
}
function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
