"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal/Modal";
import { Pagination as SharedPagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import { cn } from "@/lib/cn";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import {
  acceptEmergencyAllocationItem,
  confirmEmergencyAllocationReceipt,
  getEmergencyNotifications,
  markEmergencyNotificationRead,
  notifyFamilyHeadsForEmergencyAllocation,
  rejectEmergencyAllocationItem,
} from "@/services/emergencyService";
import type { EmergencyNotification } from "@/types/emergency";
import styles from "./EmergencyNotificationsPanel.module.css";

type ActionState = "idle" | "loading" | "accepting" | "rejecting" | "confirming" | "notifying";

export function EmergencyNotificationsPanel({ openRequest, onOpenRequestHandled }: { openRequest?: { id: string; version: number } | null; onOpenRequestHandled?: (version: number) => void } = {}) {
  const handledOpenRequest = useRef<number | null>(null);
  const pageSize = 5;
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications.emergency,
    queryFn: getEmergencyNotifications,
    staleTime: queryStaleTime.operational,
  });
  const notifications = notificationsQuery.data ?? [];
  useEffect(() => {
    if (!openRequest || handledOpenRequest.current === openRequest.version || !notificationsQuery.data) return;
    const notification = notificationsQuery.data.find((row) => row.notification_id === openRequest.id);
    if (!notification) return;
    handledOpenRequest.current = openRequest.version;
    void openNotification(notification);
    onOpenRequestHandled?.(openRequest.version);
  }, [openRequest, notificationsQuery.data, onOpenRequestHandled]);
  const error = actionError || (notificationsQuery.error instanceof Error ? notificationsQuery.error.message : notificationsQuery.error ? "Unable to load emergency notifications." : null);
  const isInitialLoading = notificationsQuery.isPending;
  const isBackgroundRefreshing = notificationsQuery.isFetching && !notificationsQuery.isPending;

  const selected = useMemo(
    () => notifications.find((notification) => notification.notification_id === selectedId) ?? null,
    [notifications, selectedId],
  );
  const unreadCount = notifications.filter((notification) => notification.status === "pending" || notification.status === "sent").length;
  const paginatedNotifications = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(notifications.length / pageSize));
    const safePage = Math.min(page, totalPages);
    return {
      rows: notifications.slice((safePage - 1) * pageSize, safePage * pageSize),
      pagination: { page: safePage, limit: pageSize, total: notifications.length, totalPages } satisfies PaginationState,
    };
  }, [notifications, page]);

  useEffect(() => {
    if (page !== paginatedNotifications.pagination.page) setPage(paginatedNotifications.pagination.page);
  }, [page, paginatedNotifications.pagination.page]);

  const invalidateRelatedQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.emergency }),
      queryClient.invalidateQueries({ queryKey: queryKeys.relief.currentAllocation }),
      queryClient.invalidateQueries({ queryKey: queryKeys.relief.campaigns }),
    ]);
  };

  async function openNotification(notification: EmergencyNotification) {
    setSelectedId(notification.notification_id);
    setMessage(null);
    setActionError(null);

    if (notification.status !== "pending" && notification.status !== "sent") return;

    try {
      const updated = await markEmergencyNotificationRead(notification.notification_id);
      if (updated) {
        mergeNotification({ ...notification, ...updated });
        await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.emergency });
      }
    } catch (readError) {
      setActionError(readError instanceof Error ? readError.message : "Unable to mark notification as read.");
    }
  }

  async function handleAllocationAction(action: "accept" | "reject") {
    if (!selected?.allocation_item?.item_id) return;

    try {
      setActionState(action === "accept" ? "accepting" : "rejecting");
      setActionError(null);
      setMessage(null);
      const response = action === "accept"
        ? await acceptEmergencyAllocationItem(selected.allocation_item.item_id)
        : await rejectEmergencyAllocationItem(selected.allocation_item.item_id);

      if (response?.notification) {
        mergeNotification(response.notification);
        setSelectedId(response.notification.notification_id);
      } else if (response?.allocation_item) {
        mergeNotification({
          ...selected,
          allocation_item: response.allocation_item,
        });
      }

      setMessage(action === "accept" ? "Allocation Accepted" : "Allocation Rejected");
      await invalidateRelatedQueries();
    } catch (actionError) {
      setActionError(actionError instanceof Error ? actionError.message : `Unable to ${action} allocation.`);
    } finally {
      setActionState("idle");
    }
  }

  async function handleReceiptConfirmation() {
    if (!selected?.allocation_item?.item_id) return;

    try {
      setActionState("confirming");
      setActionError(null);
      setMessage(null);
      const response = await confirmEmergencyAllocationReceipt(selected.allocation_item.item_id);
      if (response?.notification) {
        mergeNotification(response.notification);
        setSelectedId(response.notification.notification_id);
      } else if (response?.allocation_item) {
        mergeNotification({ ...selected, allocation_item: response.allocation_item });
      }
      setMessage("Relief Received");
      await invalidateRelatedQueries();
    } catch (confirmationError) {
      setActionError(confirmationError instanceof Error ? confirmationError.message : "Unable to confirm relief receipt.");
    } finally {
      setActionState("idle");
    }
  }

  async function handleNotifyFamilyHeads() {
    if (!selected?.allocation_item?.item_id) return;

    try {
      setActionState("notifying");
      setActionError(null);
      setMessage(null);
      const response = await notifyFamilyHeadsForEmergencyAllocation(selected.allocation_item.item_id);
      if (response?.notification) {
        mergeNotification(response.notification);
        setSelectedId(response.notification.notification_id);
      } else if (response?.allocation_item) {
        mergeNotification({ ...selected, allocation_item: response.allocation_item });
      }
      const created = Number(response?.notifications_created ?? 0);
      setMessage(created > 0 ? `Family Heads Notified: ${created}` : "Family Heads Notified");
      await invalidateRelatedQueries();
    } catch (notificationError) {
      setActionError(notificationError instanceof Error ? notificationError.message : "Unable to notify family heads.");
    } finally {
      setActionState("idle");
    }
  }

  function mergeNotification(updated: EmergencyNotification) {
    queryClient.setQueryData(queryKeys.notifications.emergency, (current: EmergencyNotification[] | undefined) => (current ?? []).map((notification) => (
      notification.notification_id === updated.notification_id
        ? {
          ...notification,
          ...updated,
          allocation_item: updated.allocation_item ?? notification.allocation_item ?? null,
          batch: updated.batch ?? notification.batch ?? null,
        }
        : notification
    )));
  }

  return (
    <section className={styles.stack} aria-label="Emergency relief notifications">
      <div className={styles.summary}>
        <div>
          <span>Emergency Relief</span>
          <h3>Barangay Allocation Inbox</h3>
          <p>Review allocation notices sent by CSWDD before distribution continues.</p>
        </div>
        <strong>Unread: {unreadCount}</strong>
      </div>

      {message ? <p className={styles.stateMessage}>{message}</p> : null}
      {error ? <p className={styles.errorMessage}>{error}</p> : null}
      {isBackgroundRefreshing ? <p className={styles.stateMessage}>Refreshing notifications...</p> : null}

      {isInitialLoading ? (
        <div className={styles.emptyState}>Loading emergency notifications...</div>
      ) : notifications.length === 0 ? (
        <div className={styles.emptyState}>No emergency relief notifications for your barangay yet.</div>
      ) : (
        <div className={styles.grid}>
          {paginatedNotifications.rows.map((notification) => (
            <article className={styles.card} key={notification.notification_id}>
              <div className={styles.cardHeader}>
                <span className={cn(styles.status, styles[statusTone(notification.status)])}>{formatStatus(notification.status)}</span>
                <time>{formatDate(notification.created_at)}</time>
              </div>
              <h3>{notification.title}</h3>
              <p>{notification.message}</p>
              <AllocationMetrics notification={notification} />
              <button className={styles.primaryButton} type="button" onClick={() => openNotification(notification)}>
                View Allocation
              </button>
            </article>
          ))}
        </div>
      )}

      <SharedPagination pagination={paginatedNotifications.pagination} onPageChange={setPage} label="Emergency notifications" />

      <Modal className={styles.allocationDialog} isOpen={Boolean(selected)} onClose={() => setSelectedId(null)} labelledBy="emergency-allocation-title" size="xl">
        {selected ? (
          <>
            <header className={styles.modalHeader}>
              <div>
                <span>{selected.batch?.plan_name ?? "Emergency Relief Allocation"}</span>
                <h2 id="emergency-allocation-title">{selected.allocation_item?.barangay_name ?? "Barangay Allocation"}</h2>
                <p>This notice is for reviewing the emergency allocation only. It does not confirm physical receipt.</p>
              </div>
              <button type="button" aria-label="Close allocation details" onClick={() => setSelectedId(null)}>x</button>
            </header>

            <div className={styles.modalBody}>
              <AllocationMetrics notification={selected} variant="large" />
              <dl className={styles.details}>
                <div>
                  <dt>Notification Status</dt>
                  <dd>{formatStatus(selected.status)}</dd>
                </div>
                <div>
                  <dt>Allocation Status</dt>
                  <dd>{formatStatus(selected.allocation_item?.barangay_status ?? "unknown")}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>{formatDate(selected.created_at)}</dd>
                </div>
                <div>
                  <dt>Batch</dt>
                  <dd>{shortId(selected.allocation_item?.batch_id ?? selected.batch?.batch_id)}</dd>
                </div>
              </dl>
              <p className={styles.explanation}>
                {workflowExplanation(selected)}
              </p>
            </div>

            <WorkflowActions
              actionState={actionState}
              notification={selected}
              onAccept={() => handleAllocationAction("accept")}
              onConfirmReceipt={handleReceiptConfirmation}
              onNotifyFamilyHeads={handleNotifyFamilyHeads}
              onReject={() => handleAllocationAction("reject")}
            />
          </>
        ) : null}
      </Modal>
    </section>
  );
}

function AllocationMetrics({ notification, variant = "default" }: { notification: EmergencyNotification; variant?: "default" | "large" }) {
  const item = notification.allocation_item;
  return (
    <div className={cn(styles.metrics, variant === "large" && styles.largeMetrics)}>
      <Metric label="Family Food Packs" value={item?.family_food_packs ?? 0} />
      <Metric label="Emergency Kits" value={item?.emergency_kits ?? 0} />
      <Metric label="Individual Relief Goods" value={item?.individual_relief_goods ?? 0} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function WorkflowActions({
  actionState,
  notification,
  onAccept,
  onConfirmReceipt,
  onNotifyFamilyHeads,
  onReject,
}: {
  actionState: ActionState;
  notification: EmergencyNotification;
  onAccept: () => void;
  onConfirmReceipt: () => void;
  onNotifyFamilyHeads: () => void;
  onReject: () => void;
}) {
  const status = notification.allocation_item?.barangay_status ?? "";
  const busy = actionState === "accepting" || actionState === "rejecting" || actionState === "confirming" || actionState === "notifying";

  if (status === "notified") {
    return (
      <footer className={styles.modalActions}>
        <button className={styles.secondaryButton} type="button" disabled={busy} onClick={onReject}>
          {actionState === "rejecting" ? "Rejecting..." : "Reject Allocation"}
        </button>
        <button className={styles.primaryButton} type="button" disabled={busy} onClick={onAccept}>
          {actionState === "accepting" ? "Accepting..." : "Accept Allocation"}
        </button>
      </footer>
    );
  }

  if (status === "accepted") {
    return (
      <footer className={styles.modalActions}>
        <p className={styles.workflowNote}>Allocation Accepted</p>
        <button className={styles.primaryButton} type="button" disabled={busy} onClick={onConfirmReceipt}>
          {actionState === "confirming" ? "Confirming..." : "Confirm Relief Received"}
        </button>
      </footer>
    );
  }

  if (status === "receipt_confirmed") {
    return (
      <footer className={styles.modalActions}>
        <p className={styles.workflowNote}>Relief Received</p>
        <button className={styles.primaryButton} type="button" disabled={busy} onClick={onNotifyFamilyHeads}>
          {actionState === "notifying" ? "Notifying..." : "Notify Family Heads"}
        </button>
      </footer>
    );
  }

  if (status === "family_heads_notified") {
    return (
      <footer className={styles.modalActions}>
        <p className={styles.workflowNote}>Family Heads Notified</p>
      </footer>
    );
  }

  return (
    <footer className={styles.modalActions}>
      <p className={styles.workflowNote}>{status === "rejected" ? "Allocation Rejected" : formatStatus(status)}</p>
    </footer>
  );
}

function workflowExplanation(notification: EmergencyNotification) {
  const status = notification.allocation_item?.barangay_status ?? "";
  if (status === "accepted") {
    return "The barangay accepted this allocation. Confirm relief received only after the physical goods have actually arrived.";
  }
  if (status === "receipt_confirmed") {
    return "The barangay has confirmed physical receipt. Family heads can now be notified about the upcoming relief distribution schedule.";
  }
  if (status === "family_heads_notified") {
    return "Family heads were notified. QR-based distribution verification is not part of this step.";
  }
  return "CSWDD selected this AI relief strategy and sent your barangay allocation for review. Accepting means the barangay agrees to proceed with this allocation; physical receipt must be confirmed separately.";
}

function statusTone(status: string) {
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "rejected";
  if (status === "receipt_confirmed") return "received";
  if (status === "family_heads_notified") return "notified";
  if (status === "read") return "read";
  return "pending";
}

function formatStatus(status: string) {
  return String(status || "unknown").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

function shortId(value?: string | null) {
  if (!value) return "Not recorded";
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}
