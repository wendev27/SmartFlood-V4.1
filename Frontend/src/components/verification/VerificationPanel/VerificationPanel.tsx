"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ApplicationFormValues, ModalMode, VerificationApplication, VerificationStatus } from "@/types/verification";
import { withAuditActor } from "@/lib/auditClient";
import { normalizeBarangayForCompare } from "@/lib/formatters";
import { barangayIdForName } from "@/lib/barangayScope";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import { fetchJson } from "@/services/apiClient";
import { getVerificationApplications } from "@/services/verificationService";
import { ActionResultModal, type ActionResultType } from "@/components/ui/ActionResultModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Pagination as SharedPagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import { Tabs } from "@/components/ui/Tabs/Tabs";
import { ApplicationCard } from "@/components/verification/ApplicationCard/ApplicationCard";
import { ApplicationFormModal } from "@/components/verification/ApplicationFormModal/ApplicationFormModal";
import { ReviewModal } from "@/components/verification/ReviewModal/ReviewModal";
import { SmartFloodIcon } from "@/components/icons/SmartFloodIcon";
import styles from "./VerificationPanel.module.css";

export function VerificationPanel({ barangayScope }: { barangayScope?: string } = {}) {
  const pageSize = 5;
  const queryClient = useQueryClient();
  const scopedBarangayId = barangayIdForName(barangayScope);
  const [activeTab, setActiveTab] = useState<VerificationStatus>("pending");
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isApplicationOpen, setIsApplicationOpen] = useState(false);
  const [applicationMode, setApplicationMode] = useState<ModalMode>("add");
  const [selectedApplication, setSelectedApplication] = useState<VerificationApplication | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [resultModal, setResultModal] = useState({
    open: false,
    type: "success" as ActionResultType,
    title: "",
    description: "",
    details: "",
  });
  const applicationsQuery = useQuery({
    queryKey: queryKeys.verification.applications(scopedBarangayId),
    queryFn: () => getVerificationApplications(scopedBarangayId),
    staleTime: queryStaleTime.admin,
  });
  const applications = useMemo(() => {
    const rows = (applicationsQuery.data ?? []).map(mapApplication);
    if (!barangayScope) return rows;
    const expected = normalizeBarangayForCompare(barangayScope).replace(/^barangay\s+/, "");
    return rows.filter((application) => normalizeBarangayForCompare(application.barangay).replace(/^barangay\s+/, "") === expected);
  }, [applicationsQuery.data, barangayScope]);
  const isLoading = applicationsQuery.isPending;
  const isBackgroundRefreshing = applicationsQuery.isFetching && !applicationsQuery.isPending;
  const error = applicationsQuery.error instanceof Error ? applicationsQuery.error.message : applicationsQuery.error ? "Unable to load applications." : "";
  const fetchApplications = () => applicationsQuery.refetch();

  const visibleApplications = useMemo(
    () => {
      const normalizedSearch = normalizeBarangayForCompare(search);
      return applications.filter((application) => {
        if (application.status !== activeTab) return false;
        if (!normalizedSearch) return true;

        const raw = application.raw ?? {};
        const searchable = [
          application.application_id,
          application.name,
          application.status,
          application.type,
          application.barangay,
          application.familyMembers,
          application.submitted,
          application.phone,
          application.address,
          raw.first_name,
          raw.middle_name,
          raw.last_name,
          raw.contact_number,
          raw.complete_address,
          raw.barangay_name,
          raw.status,
          raw.total_family_members,
          raw.created_at,
        ].join(" ");

        return normalizeBarangayForCompare(searchable).includes(normalizedSearch);
      });
    },
    [activeTab, applications, search],
  );
  const paginatedApplications = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(visibleApplications.length / pageSize));
    const safePage = Math.min(page, totalPages);
    return {
      rows: visibleApplications.slice((safePage - 1) * pageSize, safePage * pageSize),
      pagination: { page: safePage, limit: pageSize, total: visibleApplications.length, totalPages } satisfies PaginationState,
    };
  }, [page, visibleApplications]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, search]);

  useEffect(() => {
    if (page !== paginatedApplications.pagination.page) setPage(paginatedApplications.pagination.page);
  }, [page, paginatedApplications.pagination.page]);

  const counts = useMemo(() => ({
    pending: String(applications.filter((application) => application.status === "pending").length),
    approved: String(applications.filter((application) => application.status === "approved").length),
    rejected: String(applications.filter((application) => application.status === "rejected").length),
  }), [applications]);

  async function reviewApplication(action: "approved" | "rejected") {
    if (!selectedApplication) return;
    if (selectedApplication.status !== "pending") {
      setResultModal({
        open: true,
        type: "error",
        title: "Application Already Reviewed",
        description: "This application has already been reviewed.",
        details: "Approved and rejected applications are read-only.",
      });
      return;
    }

    const selectedFamilyId = selectedApplication.raw?.selected_family_id ?? selectedApplication.raw?.family_id;
    const body: Record<string, unknown> = {
      action,
      admin_review_notes: action === "approved" ? "Approved from SmartFlood admin dashboard" : "Rejected from SmartFlood admin dashboard",
    };
    if (scopedBarangayId) body.barangay_id = scopedBarangayId;

    if (action === "approved" && !selectedApplication.raw?.is_family_head) {
      body.selected_family_id = selectedFamilyId || window.prompt("Enter selected family ID for this resident");
    }

    try {
      await fetchJson(`/api/resident-applications/${selectedApplication.application_id}/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withAuditActor(body)),
      });
    } catch (reviewError) {
      setResultModal({
        open: true,
        type: "error",
        title: action === "approved" ? "Failed to Approve Application" : "Failed to Reject Application",
        description: reviewError instanceof Error ? reviewError.message : "Unable to review application",
        details: "The application status was not changed. Please try the review action again.",
      });
      return;
    }

    setIsReviewOpen(false);
    setSelectedApplication(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.verification.applications(scopedBarangayId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.residents.list(scopedBarangayId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.residents.families("", scopedBarangayId) }),
    ]);
    setResultModal({
      open: true,
      type: action === "approved" ? "success" : "warning",
      title: action === "approved" ? "Application Approved Successfully" : "Application Rejected Successfully",
      description: action === "approved"
        ? "The resident application has been approved and moved to approved records."
        : "The resident application has been rejected and moved to rejected records.",
      details: "The applicant list and tab counts have been refreshed.",
    });
  }

  const emptyFormValues: ApplicationFormValues = {
    surname: "",
    firstName: "",
    middleName: "",
    contactNumber: "",
    ageSex: "",
    occupation: "",
    completeAddress: "",
    barangay: "",
    totalFamilyMembers: "",
    householdHead: "",
    specialNeeds: "",
    medicalConditions: "",
  };

  const formValues = emptyFormValues;

  return (
    <section className={styles.panel} aria-label="Resident account verification">
      <button className={styles.backButton} type="button" onClick={() => { window.location.hash = "dashboard"; }}>← Back</button>
      <h1>Resident Account Registration Management</h1>
      <Tabs
        ariaLabel="Verification status"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "pending", label: "Pending Review", count: counts.pending, icon: <SmartFloodIcon name="pendingReview" size={20} /> },
          { key: "approved", label: "Approved", count: counts.approved, countTone: "green", icon: <SmartFloodIcon name="approved" size={20} /> },
          { key: "rejected", label: "Rejected", count: counts.rejected, countTone: "red", icon: <SmartFloodIcon name="rejected" size={20} /> },
        ]}
      />
      <div className={styles.searchToolbar}>
        <label className={styles.searchField}>
          <span className="srOnly">Search resident account applications</span>
          <span className={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by applicant, barangay, phone, address, or application ID..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {error ? <ErrorState title="Unable to Load Applications" message={error} retryLabel="Retry" onRetry={fetchApplications} /> : null}
      {isLoading ? <LoadingState message="Loading applications..." /> : null}
      {isBackgroundRefreshing ? <p className={styles.errorMessage} role="status">Refreshing applications...</p> : null}
      <div className={styles.list}>
        {paginatedApplications.rows.map((application, index) => (
          <ApplicationCard
            key={application.application_id || `${String(application.raw?.first_name ?? "")}-${String(application.raw?.last_name ?? "")}-${index}`}
            application={application}
            onReview={() => {
              setSelectedApplication(application);
              setIsReviewOpen(true);
            }}
          />
        ))}
        {!isLoading && visibleApplications.length === 0 ? (
          <EmptyState
            title={emptyTitleFor(activeTab)}
            description={search ? "Try another applicant name, barangay, phone, address, or application ID." : emptyDescriptionFor(activeTab)}
          />
        ) : null}
      </div>
      <SharedPagination pagination={paginatedApplications.pagination} onPageChange={setPage} label="Resident applications" />
      <ReviewModal
        isOpen={isReviewOpen}
        application={selectedApplication}
        onApprove={() => reviewApplication("approved")}
        onReject={() => reviewApplication("rejected")}
        onClose={() => setIsReviewOpen(false)}
      />
      <ApplicationFormModal
        isOpen={isApplicationOpen}
        mode={applicationMode}
        values={formValues}
        onClose={() => setIsApplicationOpen(false)}
      />
      <ActionResultModal
        open={resultModal.open}
        type={resultModal.type}
        title={resultModal.title}
        description={resultModal.description}
        details={resultModal.details}
        primaryLabel="OK"
        onPrimary={() => setResultModal((current) => ({ ...current, open: false }))}
        onClose={() => setResultModal((current) => ({ ...current, open: false }))}
      />
    </section>
  );
}

function emptyTitleFor(status: VerificationStatus) {
  if (status === "approved") return "No approved applications";
  if (status === "rejected") return "No rejected applications";
  return "No pending applications";
}

function emptyDescriptionFor(status: VerificationStatus) {
  if (status === "approved") return "Approved resident applications will appear here.";
  if (status === "rejected") return "Rejected resident applications will appear here.";
  return "New resident account applications awaiting review will appear here.";
}

function mapApplication(row: Record<string, unknown>): VerificationApplication {
  const firstName = String(row.first_name ?? "");
  const lastName = String(row.last_name ?? "");
  const name = [firstName, row.middle_name, lastName].filter(Boolean).join(" ") || "Unnamed Applicant";
  const initials = [firstName[0], lastName[0]].filter(Boolean).join("").toUpperCase() || "NA";

  return {
    application_id: row.application_id ? String(row.application_id) : undefined,
    initials,
    name,
    status: (row.status === "approved" || row.status === "rejected" ? row.status : "pending") as VerificationStatus,
    type: row.is_family_head ? "Family Head" : "Family Member",
    barangay: String(row.barangay_name ?? row.barangay ?? ""),
    familyMembers: String(row.total_family_members ?? ""),
    submitted: String(row.created_at ?? row.submitted_at ?? ""),
    phone: String(row.contact_number ?? ""),
    address: String(row.complete_address ?? ""),
    approvalNote: row.reviewed_at ? {
      approvedBy: `Reviewed ${String(row.reviewed_at)}`,
      details: String(row.admin_review_notes ?? ""),
    } : undefined,
    raw: row,
  };
}
