"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Pagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import { getCurrentUser, logLabelForRole, normalizeUserRole } from "@/lib/authSession";
import { cn } from "@/lib/cn";
import { formatBarangayName, normalizeBarangayForCompare } from "@/lib/formatters";
import { filterLogsForViewer } from "@/lib/logVisibility";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import { getAuditLogs } from "@/services/logsService";
import type { AuditLog } from "@/types/logs";
import styles from "./SystemLogs.module.css";

export function SystemLogs() {
  const pageSize = 5;
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
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

  const roleScopedLogs = useMemo(() => filterLogsForViewer(logsSource, user), [logsSource, user]);
  const moduleOptions = useMemo(() => unique(roleScopedLogs.map((log) => log.module ?? "")), [roleScopedLogs]);
  const actionOptions = useMemo(() => unique(roleScopedLogs.map((log) => log.action)), [roleScopedLogs]);

  const logs = useMemo(() => {
    const normalizedQuery = normalizeBarangayForCompare(query);
    return roleScopedLogs.filter((log) => {
      const searchable = [
        log.actor_name,
        log.actor_role,
        log.action,
        log.module,
        log.description,
        log.barangay_name,
        log.created_at,
      ].join(" ");
      const matchesQuery = !normalizedQuery || normalizeBarangayForCompare(searchable).includes(normalizedQuery);
      return matchesQuery
        && (!moduleFilter || log.module === moduleFilter)
        && (!actionFilter || log.action === actionFilter);
    });
  }, [actionFilter, moduleFilter, query, roleScopedLogs]);

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
  }, [actionFilter, moduleFilter, query]);

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
              placeholder="Search logs by actor, action, module, or barangay..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)} aria-label="Module">
            <option value="">All Modules</option>
            {moduleOptions.map((module) => <option key={module} value={module}>{module}</option>)}
          </select>
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} aria-label="Action">
            <option value="">All Actions</option>
            {actionOptions.map((action) => <option key={action} value={action}>{action}</option>)}
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
              <th>Department</th>
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
                <td>{departmentForLog(log)}</td>
                <td>{formatBarangayName(log.description || log.module || "-")}</td>
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
      </article>
      <Pagination pagination={paginatedLogs.pagination} onPageChange={setPage} label="Audit logs" />

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
                <Detail label="Module" value={previewLog.module || "-"} />
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
    ["Department", log.department],
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

function departmentForLog(log: AuditLog) {
  const explicitDepartment = String(log.department ?? "").trim();
  if (explicitDepartment && !/^(system|sensor|authentication)$/i.test(explicitDepartment)) {
    return formatBarangayName(explicitDepartment);
  }
  if (log.barangay_name) return formatBarangayName(log.barangay_name);

  const source = `${log.actor_role ?? ""} ${log.module ?? ""}`;
  if (/cswdd|city welfare/i.test(source)) return "CSWDD";
  if (/barangay/i.test(source)) return "Barangay";
  if (/cdrrmo|ndrrmo|command center|disaster/i.test(source)) return "CDRRMO";
  return explicitDepartment ? formatBarangayName(explicitDepartment) : "System";
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}
