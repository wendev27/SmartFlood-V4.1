"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { withAuditActor } from "@/lib/auditClient";
import { cn } from "@/lib/cn";
import { ActionResultModal, type ActionResultType } from "@/components/ui/ActionResultModal";
import { Button } from "@/components/ui/Button/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { Modal } from "@/components/ui/Modal/Modal";
import { Pagination as SharedPagination, type PaginationState } from "@/components/ui/Pagination/Pagination";
import { getCurrentUser, type StoredSessionUser } from "@/lib/authSession";
import { assignedBarangayForUser, barangayIdForName, isSameBarangayForUser } from "@/lib/barangayScope";
import { createStructuredHouseholdMember, getHouseholdMemberAgePreview, isValidStructuredHouseholdMemberDraft, readStructuredHouseholdMembers } from "@/lib/householdMembers";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import { fetchJson } from "@/services/apiClient";
import { getFamilies, getFamilyCoverage, getFamilyMembers, getResidents, type FamilyCoverageRow } from "@/services/residentsService";
import { getVerificationApplication } from "@/services/verificationService";
import type { StructuredHouseholdMember } from "@/types/householdMembers";
import { formatBarangayName, normalizeBarangayForCompare } from "@/lib/formatters";
import { SHOW_STRUCTURED_HOUSEHOLD_MEMBERS } from "@/lib/featureFlags";
import styles from "./ResidentsPanel.module.css";

type ResidentRow = {
  resident_id?: string;
  application_id?: string;
  middle_name?: string;
  suffix?: string;
  first_name?: string;
  last_name?: string;
  name: string;
  age: number | string;
  sex: string;
  address: string;
  barangay: string;
  barangay_id?: number | string;
  contact: string;
  street?: string;
  family_id?: string;
  birth_date?: string | null;
  age_source?: "birth_date" | "legacy" | "unavailable";
  age_classification?: string;
  is_family_head?: boolean;
  selected?: boolean;
};

type FamilyRow = {
  family_id?: string;
  family_head_id?: string;
  barangay_id?: number | string;
  familyName: string;
  familyHead: string;
  barangay: string;
  completeAddress: string;
  street: string;
  pwd: number;
  elderly: number;
  fourPs: number;
  lactating: number;
  pregnant: number;
  infant: number;
  toddler: number;
  totalFamilyMembers: number;
};

type ResidentFormState = {
  last_name: string;
  first_name: string;
  middle_name: string;
  suffix: string;
  age: string;
  sex: string;
  contact_number: string;
  complete_address: string;
  street: string;
  barangay_id: string;
  barangay_name: string;
  is_family_head: boolean;
  selected_family_id: string;
  pwd_count: string;
  elderly_count: string;
  four_ps_count: string;
  lactating_count: string;
  pregnant_count: string;
  infant_count: string;
  toddler_count: string;
};

const barangays = [
  { id: "1", name: "Barangay Tanong" },
  { id: "2", name: "Barangay Catmon" },
  { id: "3", name: "Barangay Potrero" },
];

const emptyResidentForm: ResidentFormState = {
  last_name: "",
  first_name: "",
  middle_name: "",
  suffix: "",
  age: "",
  sex: "",
  contact_number: "",
  complete_address: "",
  street: "",
  barangay_id: "",
  barangay_name: "",
  is_family_head: true,
  selected_family_id: "",
  pwd_count: "0",
  elderly_count: "0",
  four_ps_count: "0",
  lactating_count: "0",
  pregnant_count: "0",
  infant_count: "0",
  toddler_count: "0",
};

const vulnerabilityCountFields = [
  "pwd_count",
  "elderly_count",
  "four_ps_count",
  "lactating_count",
  "pregnant_count",
  "infant_count",
  "toddler_count",
] as const;

export function ResidentsPanel({ barangayScope }: { barangayScope?: string } = {}) {
  const pageSize = 5;
  const queryClient = useQueryClient();
  const [currentUser] = useState(() => getCurrentUser());
  const canViewResidentInfo = canViewResidents(currentUser);
  const isSuperAdmin = Number(currentUser?.role_id) === 1 || residentRoleText(currentUser).includes("super");
  const canManageResidentRecords = !isSuperAdmin && canManageResidents(currentUser);
  const showResidentActions = canManageResidentRecords;
  const isBarangayOfficial = isBarangayUser(currentUser);
  const assignedBarangay = assignedBarangayForUser(currentUser);
  const scopedBarangayId = barangayIdForName(barangayScope);
  const [residentSearch, setResidentSearch] = useState("");
  const [familySearch, setFamilySearch] = useState("");
  const [residentPage, setResidentPage] = useState(1);
  const [familyPage, setFamilyPage] = useState(1);
  const [connectedResidentPage, setConnectedResidentPage] = useState(1);
  const [selectedResident, setSelectedResident] = useState<ResidentRow | null>(null);
  const [selectedFamily, setSelectedFamily] = useState<FamilyRow | null>(null);
  const [isResidentModalOpen, setIsResidentModalOpen] = useState(false);
  const [residentModalMode, setResidentModalMode] = useState<"add" | "edit">("add");
  const [editingResidentId, setEditingResidentId] = useState<string | null>(null);
  const [editingApplicationId, setEditingApplicationId] = useState<string | null>(null);
  const [editingMemberFamilyId, setEditingMemberFamilyId] = useState<string | null>(null);
  const [householdMemberDrafts, setHouseholdMemberDrafts] = useState<StructuredHouseholdMember[]>([]);
  const [householdMembersAtOpen, setHouseholdMembersAtOpen] = useState<StructuredHouseholdMember[]>([]);
  const [residentForm, setResidentForm] = useState<ResidentFormState>(emptyResidentForm);
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultModal, setResultModal] = useState({
    open: false,
    type: "success" as ActionResultType,
    title: "",
    description: "",
    details: "",
  });
  const residentsQuery = useQuery({
    queryKey: queryKeys.residents.list(scopedBarangayId),
    queryFn: () => getResidents(scopedBarangayId),
    staleTime: queryStaleTime.admin,
    enabled: canViewResidentInfo,
  });
  const familiesQuery = useQuery({
    queryKey: queryKeys.residents.families("", scopedBarangayId),
    queryFn: () => getFamilies("", scopedBarangayId),
    staleTime: queryStaleTime.admin,
    enabled: canViewResidentInfo,
  });
  const focusedFamilyId = selectedResident?.family_id ?? editingMemberFamilyId ?? selectedFamily?.family_id ?? null;
  const familyMembersQuery = useQuery({
    queryKey: queryKeys.residents.familyMembers(focusedFamilyId),
    queryFn: () => getFamilyMembers(focusedFamilyId as string),
    staleTime: queryStaleTime.admin,
    enabled: SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && canViewResidentInfo && Boolean(focusedFamilyId),
  });
  const focusedApplicationId = selectedResident?.application_id ?? editingApplicationId;
  const linkedApplicationQuery = useQuery({
    queryKey: queryKeys.verification.application(focusedApplicationId, scopedBarangayId),
    queryFn: () => getVerificationApplication(focusedApplicationId as string, scopedBarangayId),
    staleTime: queryStaleTime.admin,
    enabled: canViewResidentInfo && Boolean(focusedApplicationId),
  });
  const familyCoverageQuery = useQuery({
    queryKey: queryKeys.residents.familyCoverage(scopedBarangayId),
    queryFn: () => getFamilyCoverage(scopedBarangayId),
    staleTime: queryStaleTime.admin,
    enabled: SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && canViewResidentInfo,
  });
  const residents = useMemo(
    () => filterRecordsForBarangay(filterRecordsForUser((residentsQuery.data ?? []).map(mapResident), currentUser), barangayScope),
    [barangayScope, currentUser, residentsQuery.data],
  );
  const familyClusters = useMemo(
    () => filterRecordsForBarangay(filterRecordsForUser((familiesQuery.data ?? []).map(mapFamily), currentUser), barangayScope),
    [barangayScope, currentUser, familiesQuery.data],
  );
  const isResidentsLoading = residentsQuery.isPending && canViewResidentInfo;
  const isFamiliesLoading = familiesQuery.isPending && canViewResidentInfo;
  const residentsError = residentsQuery.error instanceof Error ? residentsQuery.error.message : residentsQuery.error ? "Unable to load residents." : "";
  const familiesError = familiesQuery.error instanceof Error ? familiesQuery.error.message : familiesQuery.error ? "Unable to load family clusters." : "";
  const familyMembers = useMemo(
    () => readStructuredHouseholdMembers(familyMembersQuery.data ?? []),
    [familyMembersQuery.data],
  );
  const familyMembersError = familyMembersQuery.error instanceof Error ? familyMembersQuery.error.message : familyMembersQuery.error ? "Unable to load household members." : "";
  const selectedFamilyCoverage = useMemo<FamilyCoverageRow | null>(
    () => selectedFamily?.family_id
      ? familyCoverageQuery.data?.families.find((row) => row.family_id === selectedFamily.family_id) ?? null
      : null,
    [familyCoverageQuery.data, selectedFamily],
  );
  const refreshResidents = () => residentsQuery.refetch();
  const refreshFamilies = () => familiesQuery.refetch();

  const displayedResidents = useMemo(
    () => residents.filter((resident) => matchesSearch(residentSearch, [
      resident.resident_id,
      resident.first_name,
      resident.last_name,
      resident.middle_name,
      resident.name,
      resident.age,
      resident.sex,
      resident.address,
      resident.street,
      resident.barangay,
      resident.contact,
    ])),
    [residentSearch, residents],
  );

  const displayedFamilies = useMemo(
    () => familyClusters.filter((family) => matchesSearch(familySearch, [
      family.family_id,
      family.familyName,
      family.familyHead,
      family.completeAddress,
      family.street,
      family.barangay,
    ])),
    [familyClusters, familySearch],
  );

  const paginatedResidents = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(displayedResidents.length / pageSize));
    const safePage = Math.min(residentPage, totalPages);
    return {
      rows: displayedResidents.slice((safePage - 1) * pageSize, safePage * pageSize),
      pagination: { page: safePage, limit: pageSize, total: displayedResidents.length, totalPages } satisfies PaginationState,
    };
  }, [displayedResidents, residentPage]);

  const paginatedFamilies = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(displayedFamilies.length / pageSize));
    const safePage = Math.min(familyPage, totalPages);
    return {
      rows: displayedFamilies.slice((safePage - 1) * pageSize, safePage * pageSize),
      pagination: { page: safePage, limit: pageSize, total: displayedFamilies.length, totalPages } satisfies PaginationState,
    };
  }, [displayedFamilies, familyPage]);

  useEffect(() => {
    setResidentPage(1);
  }, [residentSearch]);

  useEffect(() => {
    setFamilyPage(1);
  }, [familySearch]);

  useEffect(() => {
    if (residentPage !== paginatedResidents.pagination.page) setResidentPage(paginatedResidents.pagination.page);
  }, [paginatedResidents.pagination.page, residentPage]);

  useEffect(() => {
    if (familyPage !== paginatedFamilies.pagination.page) setFamilyPage(paginatedFamilies.pagination.page);
  }, [familyPage, paginatedFamilies.pagination.page]);

  const connectedResidents = useMemo(
    () => selectedFamily?.family_id
      ? residents.filter((resident) => resident.family_id === selectedFamily.family_id)
      : [],
    [residents, selectedFamily],
  );

  const paginatedConnectedResidents = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(connectedResidents.length / pageSize));
    const safePage = Math.min(connectedResidentPage, totalPages);
    return {
      rows: connectedResidents.slice((safePage - 1) * pageSize, safePage * pageSize),
      pagination: { page: safePage, limit: pageSize, total: connectedResidents.length, totalPages } satisfies PaginationState,
    };
  }, [connectedResidentPage, connectedResidents]);

  useEffect(() => {
    setConnectedResidentPage(1);
  }, [selectedFamily?.family_id]);

  useEffect(() => {
    if (connectedResidentPage !== paginatedConnectedResidents.pagination.page) setConnectedResidentPage(paginatedConnectedResidents.pagination.page);
  }, [connectedResidentPage, paginatedConnectedResidents.pagination.page]);

  useEffect(() => {
    if (!SHOW_STRUCTURED_HOUSEHOLD_MEMBERS) return;
    if (residentModalMode !== "edit" || !editingResidentId || !editingMemberFamilyId || !familyMembersQuery.data) return;
    const loadedMembers = readStructuredHouseholdMembers(familyMembersQuery.data);
    setHouseholdMemberDrafts(loadedMembers);
    setHouseholdMembersAtOpen(loadedMembers);
  }, [editingMemberFamilyId, editingResidentId, familyMembersQuery.data, residentModalMode]);

  function openAddResident() {
    if (!canManageResidentRecords) return;
    setResidentModalMode("add");
    setEditingResidentId(null);
    setEditingApplicationId(null);
    setEditingMemberFamilyId(null);
    setHouseholdMemberDrafts([]);
    setHouseholdMembersAtOpen([]);
    setResidentForm(residentFormForUser(currentUser));
    setFormError("");
    setIsResidentModalOpen(true);
  }

  function openEditResident(resident: ResidentRow) {
    if (!canManageResidentRecords) return;
    if (isBarangayOfficial && !isSameBarangayForUser(currentUser, resident)) {
      setResultModal({
        open: true,
        type: "error",
        title: "Resident Cannot Be Edited",
        description: "Barangay Officials can only edit residents assigned to their own barangay.",
        details: "Open a resident record from your assigned barangay and try again.",
      });
      return;
    }
    const normalizedBarangay = isBarangayOfficial && assignedBarangay
      ? normalizeBarangay(assignedBarangay.barangay_name, String(assignedBarangay.barangay_id))
      : normalizeBarangay(resident.barangay ?? "", resident.barangay_id ? String(resident.barangay_id) : "");
    const family = familyClusters.find((cluster) => cluster.family_id === resident.family_id);
    setResidentModalMode("edit");
    setEditingResidentId(resident.resident_id ?? null);
    setEditingApplicationId(resident.application_id ?? null);
    setEditingMemberFamilyId(resident.family_id ?? null);
    setHouseholdMemberDrafts([]);
    setHouseholdMembersAtOpen([]);
    setResidentForm({
      ...emptyResidentForm,
      last_name: resident.last_name ?? "",
      first_name: resident.first_name ?? "",
      middle_name: resident.middle_name ?? "",
      suffix: resident.suffix ?? "",
      age: String(resident.age ?? ""),
      sex: resident.sex ?? "",
      contact_number: resident.contact ?? "",
      complete_address: resident.address ?? "",
      street: resident.street ?? "",
      barangay_id: normalizedBarangay?.id ?? "",
      barangay_name: normalizedBarangay?.name ?? resident.barangay ?? "",
      is_family_head: Boolean(resident.is_family_head),
      selected_family_id: resident.family_id ?? "",
      pwd_count: String(family?.pwd ?? 0),
      elderly_count: String(family?.elderly ?? 0),
      four_ps_count: String(family?.fourPs ?? 0),
      lactating_count: String(family?.lactating ?? 0),
      pregnant_count: String(family?.pregnant ?? 0),
      infant_count: String(family?.infant ?? 0),
      toddler_count: String(family?.toddler ?? 0),
    });
    setFormError("");
    setIsResidentModalOpen(true);
  }

  function closeResidentModal() {
    setIsResidentModalOpen(false);
    setEditingResidentId(null);
    setEditingApplicationId(null);
    setEditingMemberFamilyId(null);
    setHouseholdMemberDrafts([]);
    setHouseholdMembersAtOpen([]);
  }

  function updateForm<K extends keyof ResidentFormState>(field: K, value: ResidentFormState[K]) {
    setResidentForm((current) => ({ ...current, [field]: value }));
  }

  function updateNumberField<K extends keyof ResidentFormState>(field: K, value: string) {
    if (/^\d*$/.test(value)) updateForm(field, value as ResidentFormState[K]);
  }

  function normalizeNumberField<K extends keyof ResidentFormState>(field: K) {
    setResidentForm((current) => ({ ...current, [field]: normalizeWholeNumberInput(String(current[field] ?? "")) }));
  }

  function handleBarangayChange(value: string) {
    if (isBarangayOfficial) return;
    const barangay = barangays.find((item) => item.id === value);
    updateForm("barangay_id", value);
    updateForm("barangay_name", barangay?.name ?? "");
  }

  function selectFamily(familyId: string) {
    updateForm("selected_family_id", familyId);
  }

  async function submitResident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!canManageResidentRecords) {
      setIsResidentModalOpen(false);
      return;
    }

    const normalizedBarangay = isBarangayOfficial && assignedBarangay
      ? normalizeBarangay(assignedBarangay.barangay_name, String(assignedBarangay.barangay_id))
      : normalizeBarangay(residentForm.barangay_name, residentForm.barangay_id);
    const validationError = validateResidentForm(residentForm, normalizedBarangay);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (!normalizedBarangay) {
      setFormError("Barangay is required.");
      return;
    }

    if (!residentForm.is_family_head && !residentForm.selected_family_id) {
      setFormError("Select a family cluster before submitting a non-family-head resident.");
      return;
    }

    if (residentModalMode === "edit" && !editingResidentId) {
      setFormError("This resident cannot be edited until it has a resident ID.");
      return;
    }

    if (
      residentModalMode === "edit"
      && editingMemberFamilyId
      && residentForm.selected_family_id !== editingMemberFamilyId
    ) {
      setFormError("Change the resident's family cluster separately before managing household members.");
      return;
    }

    if (SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && householdMemberDrafts.some((member) => !isValidStructuredHouseholdMemberDraft(member))) {
      setFormError("Each household member needs valid identity, vulnerability, pregnancy-week, and birth-date values.");
      return;
    }

    const payload = buildResidentPayload(residentForm, normalizedBarangay);
    const url = residentModalMode === "edit" && editingResidentId ? `/api/residents/${editingResidentId}` : "/api/residents";
    const method = residentModalMode === "edit" ? "PATCH" : "POST";

    setIsSubmitting(true);
    try {
      const saved = await fetchJson<{ resident?: { resident_id?: string } }>(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withAuditActor(payload)),
      });

      if (SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && residentModalMode === "edit" && editingResidentId && editingMemberFamilyId) {
        await syncFamilyMembers(editingResidentId, householdMembersAtOpen, householdMemberDrafts);
      }
      if (SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && residentModalMode === "add" && residentForm.is_family_head && householdMemberDrafts.length > 0) {
        const createdResidentId = saved?.resident?.resident_id;
        if (!createdResidentId) throw new Error("The resident was created without a resident ID, so household members could not be saved.");
        await syncFamilyMembers(createdResidentId, [], householdMemberDrafts);
      }

      setResidentForm(emptyResidentForm);
      setEditingMemberFamilyId(null);
      setHouseholdMemberDrafts([]);
      setHouseholdMembersAtOpen([]);
      setIsResidentModalOpen(false);
      setResultModal({
        open: true,
        type: "success",
        title: residentModalMode === "edit" ? "Resident Updated Successfully" : "Resident Created Successfully",
        description: residentModalMode === "edit"
          ? "The resident profile has been updated with the latest information."
          : "The resident record has been saved and linked to the correct family cluster.",
        details: "Resident information is now available in the live residents table.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.residents.list(scopedBarangayId) }),
        queryClient.invalidateQueries({ queryKey: ["families"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.residents.familyMembers(editingMemberFamilyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.residents.familyCoverage(scopedBarangayId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.verification.applications(scopedBarangayId) }),
      ]);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unable to save resident. Please try again.";
      setFormError(message);
      setResultModal({
        open: true,
        type: "error",
        title: residentModalMode === "edit" ? "Failed to Update Resident" : "Failed to Create Resident",
        description: message,
        details: "Please review the form fields and try saving the resident again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!canViewResidentInfo) {
    return (
      <section className={styles.panel} aria-label="Resident information">
        <EmptyState title="Resident information is not available for this account." description="Your current role does not include access to resident records." />
      </section>
    );
  }

  return (
    <section className={cn(styles.panel, styles.barangayPanel)} aria-label="Resident information">
      <button className={styles.backButton} type="button" onClick={() => { window.location.hash = "dashboard"; }}>← Back</button>
      <h1 className={styles.pageTitle}>Resident Information</h1>
      <section className={styles.summary} aria-label="Resident summary">
        <SummaryCard label="Total Residents" value={isResidentsLoading ? "…" : residentsError ? "Unavailable" : residents.length} icon="residents" />
        <SummaryCard label="Total Families" value={isFamiliesLoading ? "…" : familiesError ? "Unavailable" : familyClusters.length} icon="families" />
        <SummaryCard label="Family Heads" value={isResidentsLoading ? "…" : residentsError ? "Unavailable" : residents.filter((resident) => resident.is_family_head).length} icon="vulnerable" />
      </section>
      <div className={styles.scrollArea}>
        <article className={styles.card}>
          <h3>All Residents</h3>
          <div className={styles.cardBody}>
            <div className={styles.toolbar}>
              <label className={styles.searchField}>
                <span className="srOnly">Search residents</span>
                <span className={styles.searchIcon} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search by name, ID, address, age, sex, or contact..."
                  value={residentSearch}
                  onChange={(event) => setResidentSearch(event.target.value)}
                />
              </label>
              {canManageResidentRecords ? (
                <button className={styles.addButton} type="button" onClick={openAddResident}>
                  + Add New Resident
                </button>
              ) : null}
            </div>
            {residentsError ? (
              <ErrorState title="Unable to Load Residents" message={residentsError} retryLabel="Retry" onRetry={refreshResidents} />
            ) : null}

            <div className={styles.wrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Age</th>
                    <th>Sex</th>
                    <th>Address</th>
                    <th>Barangay</th>
                    <th>Contact</th>
                    {showResidentActions ? <th>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {paginatedResidents.rows.map((resident, index) => (
                    <tr
                      key={resident.resident_id || `${resident.first_name}-${resident.last_name}-${index}`}
                      className={cn(resident.selected && styles.selected)}
                    >
                      <td className={styles.idCell} title={resident.resident_id}>{resident.resident_id || "Not recorded"}</td>
                      <td>
                        <button className={styles.linkButton} type="button" onClick={() => setSelectedResident(resident)}>{resident.name}</button>
                      </td>
                      <td>{resident.age}</td>
                      <td>{resident.sex}</td>
                      <td>{formatBarangayName(resident.address)}</td>
                      <td>{formatBarangayName(resident.barangay)}</td>
                      <td>{resident.contact}</td>
                      {showResidentActions ? <td>
                        {(!isBarangayOfficial || isSameBarangayForUser(currentUser, resident)) ? (
                          <button className={styles.editButton} type="button" onClick={() => openEditResident(resident)}>
                            <span aria-hidden="true">✎</span>
                            Edit
                          </button>
                        ) : (
                          <span className={styles.viewOnlyText}>View only</span>
                        )}
                      </td> : null}
                    </tr>
                  ))}
                  {isResidentsLoading ? (
                    <tr>
                      <td colSpan={showResidentActions ? 8 : 7}><LoadingState message="Loading residents..." /></td>
                    </tr>
                  ) : null}
                  {!isResidentsLoading && displayedResidents.length === 0 ? (
                    <tr>
                      <td colSpan={showResidentActions ? 8 : 7}>
                        <EmptyState
                          title={residents.length === 0 ? "No residents found" : "No residents match your search"}
                          description={residents.length === 0 ? "Resident records will appear here once they are created." : "Try another name, address, ID, age, sex, or contact number."}
                          actionLabel={canManageResidentRecords && residents.length === 0 ? "Add Resident" : undefined}
                          onAction={canManageResidentRecords && residents.length === 0 ? openAddResident : undefined}
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </article>
        <SharedPagination pagination={paginatedResidents.pagination} onPageChange={setResidentPage} label="Residents" />

        <article className={styles.card}>
          <h3>Family Cluster</h3>
          <div className={styles.cardBody}>
            <div className={cn(styles.toolbar, styles.compactToolbar)}>
              <label className={styles.searchField}>
                <span className="srOnly">Search family clusters</span>
                <span className={styles.searchIcon} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search by family ID, name, head, or address..."
                  value={familySearch}
                  onChange={(event) => setFamilySearch(event.target.value)}
                />
              </label>
            </div>
            {familiesError ? (
              <ErrorState title="Unable to Load Family Clusters" message={familiesError} retryLabel="Retry" onRetry={refreshFamilies} />
            ) : null}

            <div className={styles.wrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Family Name</th>
                    <th>Family head</th>
                    <th>PWD</th>
                    <th>Elderly</th>
                    <th>4Ps</th>
                    <th>Lactating</th>
                    <th>Pregnant</th>
                    <th>Infant</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedFamilies.rows.map((cluster, index) => (
                    <tr key={cluster.family_id || `${cluster.familyName}-${index}`}>
                      <td className={styles.idCell} title={cluster.family_id}>{cluster.family_id || "Not recorded"}</td>
                      <td>
                        <button className={styles.linkButton} type="button" onClick={() => setSelectedFamily(cluster)}>
                          {cluster.familyName}
                        </button>
                      </td>
                      <td>{cluster.familyHead}</td>
                      <td>{cluster.pwd}</td>
                      <td>{cluster.elderly}</td>
                      <td>{cluster.fourPs}</td>
                      <td>{cluster.lactating}</td>
                      <td>{cluster.pregnant}</td>
                      <td>{cluster.infant}</td>
                    </tr>
                  ))}
                  {isFamiliesLoading ? (
                    <tr>
                      <td colSpan={9}><LoadingState message="Loading family clusters..." /></td>
                    </tr>
                  ) : null}
                  {!isFamiliesLoading && displayedFamilies.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState
                          title={familyClusters.length === 0 ? "No family clusters found" : "No family clusters match your search"}
                          description={familyClusters.length === 0 ? "Family clusters are created when family head residents are registered." : "Try searching by family name, head, ID, barangay, or address."}
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </article>
        <SharedPagination pagination={paginatedFamilies.pagination} onPageChange={setFamilyPage} label="Family clusters" />
      </div>
      <Modal
        isOpen={canManageResidentRecords && isResidentModalOpen}
        onClose={closeResidentModal}
        labelledBy="resident-form-title"
        className={styles.residentDialog}
      >
        <header className={styles.modalHeader}>
          <div>
            <h2 id="resident-form-title">{residentModalMode === "add" ? "Add New Resident" : "Edit Resident"}</h2>
            <p>Resident Information</p>
          </div>
          <button className={styles.closeButton} type="button" aria-label="Close resident form" onClick={closeResidentModal}>
            x
          </button>
        </header>
        <form className={styles.residentForm} onSubmit={submitResident}>
          {formError ? <p className={styles.errorMessage}>{formError}</p> : null}

          <section className={styles.formSection}>
            <h3><span aria-hidden="true" />Personal Information</h3>
            <div className={styles.formGrid}>
              <label>
                <span>Last Name <span className={styles.requiredAsterisk}>*</span></span>
                <input value={residentForm.last_name} onChange={(event) => updateForm("last_name", event.target.value)} placeholder="e.g., Dela Cruz" />
              </label>
              <label>
                <span>First Name <span className={styles.requiredAsterisk}>*</span></span>
                <input value={residentForm.first_name} onChange={(event) => updateForm("first_name", event.target.value)} placeholder="e.g., Juan" />
              </label>
              <label>
                Middle Name
                <input value={residentForm.middle_name} onChange={(event) => updateForm("middle_name", event.target.value)} placeholder="e.g., Santos" />
              </label>
              <label>
                Suffix
                <input value={residentForm.suffix} onChange={(event) => updateForm("suffix", event.target.value)} placeholder="e.g., Jr." />
              </label>
              <label>
                <span>Age <span className={styles.requiredAsterisk}>*</span></span>
                <input value={residentForm.age} onBlur={() => normalizeNumberField("age")} onChange={(event) => updateNumberField("age", event.target.value)} placeholder="e.g., 25" type="number" min="0" />
              </label>
              <label>
                <span>Sex <span className={styles.requiredAsterisk}>*</span></span>
                <select value={residentForm.sex} onChange={(event) => updateForm("sex", event.target.value)}>
                  <option value="">Select sex</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </label>
              <label>
                <span>Contact Number <span className={styles.requiredAsterisk}>*</span></span>
                <input
                  value={residentForm.contact_number}
                  onBlur={() => {
                    const normalized = normalizePhilippineMobile(residentForm.contact_number);
                    if (normalized) updateForm("contact_number", normalized);
                  }}
                  onChange={(event) => updateForm("contact_number", event.target.value)}
                  placeholder="e.g., 0912-345-6789"
                />
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  checked={residentForm.is_family_head}
                  type="checkbox"
                  onChange={(event) => updateForm("is_family_head", event.target.checked)}
                />
                <span>Family Head</span>
              </label>
            </div>
          </section>

          <section className={styles.formSection}>
            <h3><span aria-hidden="true" />Location Information</h3>
            <div className={styles.formGrid}>
              <label className={styles.wideField}>
                <span>Complete Address <span className={styles.requiredAsterisk}>*</span></span>
                <input value={residentForm.complete_address} onChange={(event) => updateForm("complete_address", event.target.value)} placeholder="e.g., 123 Main St." />
              </label>
              <label>
                Street
                <input value={residentForm.street} onChange={(event) => updateForm("street", event.target.value)} placeholder="e.g., Main St." />
              </label>
              <label>
                Barangay
                <select disabled={isBarangayOfficial} value={residentForm.barangay_id} onChange={(event) => handleBarangayChange(event.target.value)}>
                  <option value="">Select barangay</option>
                  {barangays.map((barangay, index) => (
                    <option key={barangay.id || `${barangay.name}-${index}`} value={barangay.id}>{formatBarangayName(barangay.name)}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {residentForm.is_family_head ? (
            <section className={styles.formSection}>
              <p className={styles.helperText}>Check the box if this category is not applicable (0). Otherwise, enter the count.</p>
              <div className={styles.countGrid}>
                <CountField label="Number of PWD" value={residentForm.pwd_count} onChange={(value) => updateForm("pwd_count", value)} />
                <CountField label="Number of Elderly" value={residentForm.elderly_count} onChange={(value) => updateForm("elderly_count", value)} />
                <CountField label="Number of 4P's" value={residentForm.four_ps_count} onChange={(value) => updateForm("four_ps_count", value)} />
                <CountField label="Number of Lactating" value={residentForm.lactating_count} onChange={(value) => updateForm("lactating_count", value)} />
                <CountField label="Number of Pregnant" value={residentForm.pregnant_count} onChange={(value) => updateForm("pregnant_count", value)} />
                <CountField label="Number of Infant" value={residentForm.infant_count} onChange={(value) => updateForm("infant_count", value)} />
                <CountField label="Number of Toddler" value={residentForm.toddler_count} onChange={(value) => updateForm("toddler_count", value)} />
              </div>
            </section>
          ) : (
            <section className={styles.formSection}>
              <h3><span aria-hidden="true" />Family Cluster</h3>
              <label className={styles.modalSearchField}>
                <span className={styles.searchIcon} aria-hidden="true" />
                <input
                  aria-label="Search family clusters"
                  value={familySearch}
                  onChange={(event) => setFamilySearch(event.target.value)}
                  placeholder="Search family name, head, barangay, or address..."
                />
              </label>
              <div className={styles.wrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Family Name</th>
                      <th>Family Head</th>
                      <th>Address</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedFamilies.map((family, index) => (
                      <tr
                        key={family.family_id || `${family.familyName}-${index}`}
                        className={cn(residentForm.selected_family_id === family.family_id && styles.selected)}
                      >
                        <td>{family.familyName}</td>
                        <td>{family.familyHead}</td>
                        <td>{formatBarangayName(family.completeAddress || family.street)}</td>
                        <td>
                          <button className={styles.editButton} type="button" onClick={() => family.family_id && selectFamily(family.family_id)}>
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                    {isFamiliesLoading ? (
                      <tr>
                        <td colSpan={4}><LoadingState message="Loading family clusters..." /></td>
                      </tr>
                    ) : null}
                    {!isFamiliesLoading && displayedFamilies.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <EmptyState
                            title={familyClusters.length === 0 ? "No family clusters found" : "No family clusters match your search"}
                            description={familyClusters.length === 0 ? "Create a family head resident first before linking family members." : "Try another family name, head, barangay, ID, or address."}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <SharedPagination pagination={paginatedFamilies.pagination} onPageChange={setFamilyPage} label="Family cluster selection" />
            </section>
          )}

          {residentModalMode === "edit" && editingApplicationId ? (
            <SubmittedApplicationDetails
              applicationId={editingApplicationId}
              application={linkedApplicationQuery.data ?? null}
              isLoading={linkedApplicationQuery.isPending}
              error={linkedApplicationQuery.error instanceof Error ? linkedApplicationQuery.error.message : linkedApplicationQuery.error ? "Unable to load the submitted application." : ""}
              variant="form"
            />
          ) : null}

          {SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && (residentModalMode === "edit" || (residentModalMode === "add" && residentForm.is_family_head)) ? (
            <HouseholdMemberEditor
              members={householdMemberDrafts}
              familyId={editingMemberFamilyId ?? (residentModalMode === "add" ? "new-family" : null)}
              isLoading={residentModalMode === "edit" && familyMembersQuery.isPending}
              error={residentModalMode === "edit" ? familyMembersError : ""}
              onChange={setHouseholdMemberDrafts}
            />
          ) : null}

          <footer className={styles.formActions}>
            <Button tone="muted" type="button" onClick={closeResidentModal}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting || (!residentForm.is_family_head && !residentForm.selected_family_id)}>
              {isSubmitting ? "Saving..." : residentModalMode === "add" ? "Submit Resident" : "Save Changes"}
            </Button>
          </footer>
        </form>
      </Modal>
      <Modal
        isOpen={Boolean(selectedResident)}
        onClose={() => setSelectedResident(null)}
        labelledBy="resident-details-title"
        className={styles.familyDetailsDialog}
      >
        {selectedResident ? (
          <>
            <header className={styles.modalHeader}>
              <div>
                <h2 id="resident-details-title">{selectedResident.name}</h2>
                <p>Resident Information</p>
              </div>
              <button className={styles.closeButton} type="button" aria-label="Close resident details" onClick={() => setSelectedResident(null)}>x</button>
            </header>
            <div className={styles.familyDetailsBody}>
              <section className={styles.detailsSection}>
                <h3>Resident Details</h3>
                <dl className={styles.detailsGrid}>
                  <Detail label="Resident ID" value={selectedResident.resident_id || "Not recorded"} />
                  <Detail label="Source Application ID" value={selectedResident.application_id || "Not linked"} />
                  <Detail label="Full Name" value={selectedResident.name} />
                  <Detail label="Age" value={selectedResident.age || "Not recorded"} />
                  <Detail label="Birth Date" value={selectedResident.birth_date || "Not recorded"} />
                  <Detail label="Age Source" value={selectedResident.age_source === "birth_date" ? "Dynamic from birth date" : selectedResident.age_source === "legacy" ? "Legacy stored age" : "Unavailable"} />
                  <Detail label="Classification" value={selectedResident.age_classification ? formatClassification(selectedResident.age_classification) : "Unavailable"} />
                  <Detail label="Sex" value={selectedResident.sex || "Not recorded"} />
                  <Detail label="Contact Number" value={selectedResident.contact || "Not recorded"} />
                  <Detail label="Barangay" value={selectedResident.barangay || "Not recorded"} />
                  <Detail label="Street" value={selectedResident.street || "Not recorded"} />
                  <Detail label="Complete Address" value={selectedResident.address || "Not recorded"} />
                  <Detail label="Family ID" value={selectedResident.family_id || "Not assigned"} />
                  <Detail label="Family Head" value={familyClusters.find((family) => family.family_id === selectedResident.family_id)?.familyHead || "Not available"} />
                  <Detail label="Family Role" value={residentIsFamilyHead(selectedResident, familyClusters.find((family) => family.family_id === selectedResident.family_id)) ? "Family Head" : "Family Member"} />
                </dl>
              </section>
              {selectedResident.application_id ? (
                <SubmittedApplicationDetails
                  applicationId={selectedResident.application_id}
                  application={linkedApplicationQuery.data ?? null}
                  isLoading={linkedApplicationQuery.isPending}
                  error={linkedApplicationQuery.error instanceof Error ? linkedApplicationQuery.error.message : linkedApplicationQuery.error ? "Unable to load the submitted application." : ""}
                  variant="details"
                />
              ) : null}
              {SHOW_STRUCTURED_HOUSEHOLD_MEMBERS ? (
                <HouseholdMembersReadOnly
                  members={familyMembers}
                  familyId={selectedResident.family_id}
                  isLoading={familyMembersQuery.isPending}
                  error={familyMembersError}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>
      <Modal
        isOpen={Boolean(selectedFamily)}
        onClose={() => setSelectedFamily(null)}
        labelledBy="family-details-title"
        className={styles.familyDetailsDialog}
      >
        {selectedFamily ? (
          <>
            <header className={styles.modalHeader}>
              <div>
                <h2 id="family-details-title">{selectedFamily.familyName}</h2>
                <p>Family Cluster Details</p>
              </div>
              <button className={styles.closeButton} type="button" aria-label="Close family details" onClick={() => setSelectedFamily(null)}>
                x
              </button>
            </header>
            <div className={styles.familyDetailsBody}>
              <section className={styles.detailsSection}>
                <h3>Family Details</h3>
                <dl className={styles.detailsGrid}>
                  <Detail label="Family Name" value={selectedFamily.familyName} />
                  <Detail label="Family Head" value={selectedFamily.familyHead} />
                  <Detail label="Barangay" value={selectedFamily.barangay} />
                  <Detail label="Street" value={selectedFamily.street} />
                  <Detail label="Complete Address" value={selectedFamily.completeAddress} />
                  <Detail label="Total Family Members" value={selectedFamily.totalFamilyMembers} />
                  <Detail label="PWD" value={selectedFamily.pwd} />
                  <Detail label="Elderly" value={selectedFamily.elderly} />
                  <Detail label="4Ps" value={selectedFamily.fourPs} />
                  <Detail label="Lactating" value={selectedFamily.lactating} />
                  <Detail label="Pregnant" value={selectedFamily.pregnant} />
                  <Detail label="Infant" value={selectedFamily.infant} />
                  <Detail label="Toddler" value={selectedFamily.toddler} />
                </dl>
                {SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && familyCoverageQuery.isPending ? <p className={styles.coverageNote}>Checking dynamic household-member coverage…</p> : null}
                {SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && familyCoverageQuery.error ? <p className={styles.coverageNote}>Dynamic coverage is unavailable; the existing stored aggregate values remain displayed.</p> : null}
                {SHOW_STRUCTURED_HOUSEHOLD_MEMBERS && selectedFamilyCoverage ? <FamilyCoverageNote coverage={selectedFamilyCoverage} /> : null}
              </section>
              <section className={styles.detailsSection}>
                <h3>Connected Residents</h3>
                <div className={cn(styles.wrap, styles.connectedResidentsWrap)}>
                  <table className={cn(styles.table, styles.connectedResidentsTable)}>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Age</th>
                        <th>Sex</th>
                        <th>Contact</th>
                        <th>Family Head</th>
                        <th>Address</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedConnectedResidents.rows.map((resident, index) => (
                        <tr key={resident.resident_id || `${resident.first_name}-${resident.last_name}-${index}`}>
                          <td>{resident.name}</td>
                          <td>{resident.age}</td>
                          <td>{resident.sex}</td>
                          <td>{resident.contact}</td>
                          <td>{residentIsFamilyHead(resident, selectedFamily) ? "Yes" : "No"}</td>
                          <td>{formatBarangayName(resident.address)}</td>
                        </tr>
                      ))}
                      {connectedResidents.length === 0 ? (
                        <tr>
                          <td colSpan={6}>
                            <EmptyState
                              title="No residents linked yet"
                              description="Residents connected to this family cluster will appear here."
                            />
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <SharedPagination pagination={paginatedConnectedResidents.pagination} onPageChange={setConnectedResidentPage} label="Connected residents" />
              </section>
              {SHOW_STRUCTURED_HOUSEHOLD_MEMBERS ? (
                <HouseholdMembersReadOnly
                  members={familyMembers}
                  familyId={selectedFamily.family_id}
                  isLoading={familyMembersQuery.isPending}
                  error={familyMembersError}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>
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

async function syncFamilyMembers(
  residentId: string,
  originalMembers: StructuredHouseholdMember[],
  currentMembers: StructuredHouseholdMember[],
) {
  const originalById = new Map(originalMembers.map((member) => [member.member_id, member]));
  const currentById = new Map(currentMembers.map((member) => [member.member_id, member]));

  for (const member of currentMembers) {
    const original = originalById.get(member.member_id);
    if (!original) {
      await fetchJson(`/api/residents/${residentId}/family-members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_id: member.member_id,
          full_name: member.full_name.trim(),
          birth_date: member.birth_date,
          is_pwd: member.is_pwd,
          is_pregnant: member.is_pregnant,
          pregnancy_weeks: member.pregnancy_weeks,
          is_lactating: member.is_lactating,
          is_4ps: member.is_4ps,
        }),
      });
      continue;
    }

    if (familyMemberChanged(original, member)) {
      await fetchJson(`/api/family-members/${member.member_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: member.full_name.trim(),
          birth_date: member.birth_date,
          is_pwd: member.is_pwd,
          is_pregnant: member.is_pregnant,
          pregnancy_weeks: member.pregnancy_weeks,
          is_lactating: member.is_lactating,
          is_4ps: member.is_4ps,
        }),
      });
    }
  }

  for (const member of originalMembers) {
    if (!currentById.has(member.member_id)) {
      await fetchJson(`/api/family-members/${member.member_id}`, { method: "DELETE" });
    }
  }
}

function SubmittedApplicationDetails({
  applicationId,
  application,
  isLoading,
  error,
  variant,
}: {
  applicationId: string;
  application: Record<string, unknown> | null;
  isLoading: boolean;
  error: string;
  variant: "form" | "details";
}) {
  const groups = application ? [
    { label: "Infant", names: readSubmittedList(application.infant_full_names), birthDates: readSubmittedList(application.infant_birth_dates) },
    { label: "Toddler", names: readSubmittedList(application.toddler_full_names), birthDates: readSubmittedList(application.toddler_birth_dates) },
    { label: "Elderly", names: readSubmittedList(application.elderly_full_names), birthDates: readSubmittedList(application.elderly_birth_dates) },
    { label: "PWD", names: readSubmittedList(application.pwd_full_names), birthDates: [] },
    { label: "Pregnant", names: readSubmittedList(application.pregnant_full_names), birthDates: [] },
    { label: "Lactating", names: readSubmittedList(application.lactating_full_names), birthDates: [] },
    { label: "4Ps", names: readSubmittedList(application.four_ps_full_names), birthDates: [] },
  ].filter((group) => group.names.length > 0 || group.birthDates.length > 0) : [];
  const sectionClassName = variant === "form"
    ? `${styles.formSection} ${styles.submittedApplicationSection}`
    : `${styles.detailsSection} ${styles.submittedApplicationSection}`;

  return (
    <section className={sectionClassName}>
      <h3>{variant === "form" ? <span aria-hidden="true" /> : null}Submitted Application Details</h3>
      <p className={styles.submittedApplicationIntro}>
        Historical application information is read-only. Legacy names and birth dates remain separate submitted lists and are never paired by array position.
      </p>
      {isLoading ? <LoadingState message="Loading submitted application details..." /> : null}
      {!isLoading && error ? <p className={styles.memberErrorText}>{error}</p> : null}
      {!isLoading && !error && !application ? (
        <p className={styles.memberEmptyText}>The linked application ({applicationId}) is unavailable within the current barangay scope.</p>
      ) : null}
      {!isLoading && !error && application ? (
        <>
          {groups.length > 0 ? (
            <div className={styles.submittedApplicationGroups}>
              {groups.map((group) => (
                <article className={styles.submittedApplicationGroup} key={group.label}>
                  <h4>{group.label}</h4>
                  <div className={styles.submittedApplicationColumns}>
                    {group.names.length > 0 ? (
                      <div>
                        <strong>Names submitted</strong>
                        <ul>{group.names.map((name, index) => <li key={`${group.label}-name-${index}`}>{name}</li>)}</ul>
                      </div>
                    ) : null}
                    {group.birthDates.length > 0 ? (
                      <div>
                        <strong>Birth dates submitted</strong>
                        <ul>{group.birthDates.map((birthDate, index) => {
                          const preview = getHouseholdMemberAgePreview(birthDate);
                          return (
                            <li key={`${group.label}-birth-date-${index}`}>
                              <b>{birthDate}</b>
                              <span>Age: {preview.ageLabel ?? "Unavailable"}</span>
                              <span>Classification: {preview.classification}</span>
                            </li>
                          );
                        })}</ul>
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : <p className={styles.memberEmptyText}>No legacy household-member lists were submitted with this application.</p>}
          <dl className={styles.submittedApplicationMeta}>
            <ApplicationDetail label="Application ID" value={applicationId} />
            <ApplicationDetail label="Date Submitted" value={String(application.created_at ?? application.submitted_at ?? "Not provided")} />
            <ApplicationDetail label="Submitted By" value={String(application.source ?? "Not provided")} />
            <ApplicationDetail label="Status" value={String(application.status ?? "Not provided")} />
            <ApplicationDetail label="Reviewed At" value={String(application.reviewed_at ?? "Not reviewed")} />
            <ApplicationDetail label="Reviewed By" value={String(application.reviewed_by ?? "N/A")} />
            <ApplicationDetail label="Special Needs" value={String(application.special_needs ?? "N/A")} />
            <ApplicationDetail label="Admin Review Notes" value={String(application.admin_review_notes ?? "N/A")} />
          </dl>
        </>
      ) : null}
    </section>
  );
}

function ApplicationDetail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function readSubmittedList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
}

function familyMemberChanged(original: StructuredHouseholdMember, current: StructuredHouseholdMember) {
  return original.full_name !== current.full_name
    || original.birth_date !== current.birth_date
    || original.is_pwd !== current.is_pwd
    || original.is_pregnant !== current.is_pregnant
    || original.pregnancy_weeks !== current.pregnancy_weeks
    || original.is_lactating !== current.is_lactating
    || original.is_4ps !== current.is_4ps;
}

function HouseholdMembersReadOnly({
  members,
  familyId,
  isLoading,
  error,
}: {
  members: StructuredHouseholdMember[];
  familyId?: string;
  isLoading: boolean;
  error: string;
}) {
  return (
    <section className={styles.detailsSection}>
      <h3>Household Members</h3>
      {!familyId ? <p className={styles.memberEmptyText}>This resident is not assigned to a family cluster.</p> : null}
      {isLoading ? <LoadingState message="Loading household members..." /> : null}
      {!isLoading && error ? <p className={styles.memberErrorText}>{error}</p> : null}
      {!isLoading && !error && familyId && members.length === 0 ? (
        <p className={styles.memberEmptyText}>No structured household members are recorded for this family.</p>
      ) : null}
      {!isLoading && !error && members.length > 0 ? (
        <div className={cn(styles.wrap, styles.memberTableWrap)}>
          <table className={cn(styles.table, styles.memberTable)}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Birth Date</th>
                <th>Current Age</th>
                <th>Classification</th>
                <th>PWD</th>
                <th>Pregnant</th>
                <th>Pregnancy Weeks</th>
                <th>Lactating</th>
                <th>4Ps</th>
                <th>Resident Link</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const agePreview = getHouseholdMemberAgePreview(member.birth_date);
                return (
                  <tr key={member.member_id}>
                    <td>{member.full_name}</td>
                    <td>{member.birth_date || "Not recorded"}</td>
                    <td>{agePreview.ageLabel ?? "Unavailable"}</td>
                    <td>{formatClassification(member.classification)}</td>
                    <td>{yesNo(member.is_pwd)}</td>
                    <td>{yesNo(member.is_pregnant)}</td>
                    <td>{member.is_pregnant ? member.pregnancy_weeks ?? "Not recorded" : "N/A"}</td>
                    <td>{yesNo(member.is_lactating)}</td>
                    <td>{yesNo(member.is_4ps)}</td>
                    <td>{member.resident_id || "Not linked"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function HouseholdMemberEditor({
  members,
  familyId,
  isLoading,
  error,
  onChange,
}: {
  members: StructuredHouseholdMember[];
  familyId: string | null;
  isLoading: boolean;
  error: string;
  onChange: (members: StructuredHouseholdMember[]) => void;
}) {
  function updateMember(memberId: string, patch: Partial<StructuredHouseholdMember>) {
    onChange(members.map((member) => member.member_id === memberId ? { ...member, ...patch } : member));
  }

  return (
    <section className={styles.formSection}>
      <div className={styles.memberEditorHeading}>
        <div>
          <h3><span aria-hidden="true" />Household Members</h3>
          <p className={styles.helperText}>Structured household records. Birth date is the authoritative source for current age.</p>
        </div>
        {familyId ? (
          <button className={styles.addMemberButton} type="button" onClick={() => onChange([...members, createStructuredHouseholdMember()])}>
            + Add Member
          </button>
        ) : null}
      </div>
      {!familyId ? <p className={styles.memberEmptyText}>Assign this resident to a family cluster before managing household members.</p> : null}
      {isLoading ? <LoadingState message="Loading household members..." /> : null}
      {!isLoading && error ? <p className={styles.memberErrorText}>{error}</p> : null}
      {!isLoading && !error && familyId && members.length === 0 ? <p className={styles.memberEmptyText}>No structured household members yet. Use Add Member to create one.</p> : null}
      {!isLoading && !error && members.length > 0 ? (
        <div className={styles.memberEditorList}>
          {members.map((member) => {
            const agePreview = getHouseholdMemberAgePreview(member.birth_date);
            return (
              <article className={styles.memberEditorCard} key={member.member_id}>
                <div className={styles.memberEditorFields}>
                  <label>
                    Full Name
                    <input value={member.full_name} onChange={(event) => updateMember(member.member_id, { full_name: event.target.value })} maxLength={120} />
                  </label>
                  <label className={styles.memberCheckbox}>
                    <input type="checkbox" checked={member.is_pwd} onChange={(event) => updateMember(member.member_id, { is_pwd: event.target.checked })} />
                    PWD
                  </label>
                  <label className={styles.memberCheckbox}>
                    <input
                      type="checkbox"
                      checked={member.is_pregnant}
                      onChange={(event) => updateMember(member.member_id, {
                        is_pregnant: event.target.checked,
                        pregnancy_weeks: event.target.checked ? member.pregnancy_weeks : null,
                      })}
                    />
                    Pregnant
                  </label>
                  <label>
                    Pregnancy Weeks
                    <input
                      type="number"
                      min="0"
                      max="42"
                      disabled={!member.is_pregnant}
                      value={member.pregnancy_weeks ?? ""}
                      onChange={(event) => updateMember(member.member_id, { pregnancy_weeks: event.target.value === "" ? null : Number(event.target.value) })}
                    />
                  </label>
                  <label className={styles.memberCheckbox}>
                    <input type="checkbox" checked={member.is_lactating} onChange={(event) => updateMember(member.member_id, { is_lactating: event.target.checked })} />
                    Lactating
                  </label>
                  <label className={styles.memberCheckbox}>
                    <input type="checkbox" checked={member.is_4ps} onChange={(event) => updateMember(member.member_id, { is_4ps: event.target.checked })} />
                    4Ps
                  </label>
                  <label>
                    Birth Date
                    <input
                      type="date"
                      value={member.birth_date ?? ""}
                      onChange={(event) => updateMember(member.member_id, { birth_date: event.target.value || null })}
                    />
                  </label>
                </div>
                <div className={styles.memberEditorMeta}>
                  <span>Member ID: {member.member_id}</span>
                  <span>Current age: {agePreview.ageLabel || "Unavailable"}</span>
                  <span>Classification: {agePreview.classification}</span>
                  {member.resident_id ? <span>Resident link: {member.resident_id}</span> : null}
                  <button className={styles.removeMemberButton} type="button" onClick={() => onChange(members.filter((candidate) => candidate.member_id !== member.member_id))}>
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function FamilyCoverageNote({ coverage }: { coverage: FamilyCoverageRow }) {
  if (!coverage.coverage_complete) {
    return (
      <div className={styles.coverageNote}>
        <strong>Dynamic age coverage: Incomplete</strong>
        <span>Stored vulnerability aggregates remain the displayed family values until complete member DOB coverage is available.</span>
      </div>
    );
  }

  return (
    <div className={styles.coverageNote}>
      <strong>Dynamic age coverage: Complete</strong>
      <span>
        Dynamic age-derived counts: {coverage.dynamic_infant_count ?? 0} infant, {coverage.dynamic_toddler_count ?? 0} toddler, {coverage.dynamic_elderly_count ?? 0} elderly.
      </span>
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: number | string; icon: "residents" | "families" | "vulnerable" }) {
  return <article><span className={styles.summaryIcon}>{icon === "families" ? <HeartIcon /> : <PeopleIcon grouped={icon === "vulnerable"} />}</span><div><h2>{label}</h2><p>{value.toLocaleString()}</p></div></article>;
}

function PeopleIcon({ grouped = false }: { grouped?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx={grouped ? "8" : "12"} cy="8" r="3"/><path d={grouped ? "M2.5 20c.4-4 2.2-6 5.5-6s5.1 2 5.5 6M16 7a3 3 0 0 1 0 6m-1 2c3.5 0 5.5 1.7 6 5" : "M5 21c.6-5 2.8-7 7-7s6.4 2 7 7"}/></svg>;
}

function HeartIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>;
}

function mapResident(row: Record<string, unknown>): ResidentRow {
  const firstName = String(row.first_name ?? "");
  const lastName = String(row.last_name ?? "");

  return {
    resident_id: row.resident_id ? String(row.resident_id) : undefined,
    application_id: row.application_id ? String(row.application_id) : undefined,
    first_name: firstName,
    last_name: lastName,
    middle_name: row.middle_name ? String(row.middle_name) : "",
    suffix: row.suffix ? String(row.suffix) : "",
    name: [row.first_name, row.middle_name, row.last_name, row.suffix].filter(Boolean).join(" "),
    age: String(row.age ?? ""),
    age_classification: typeof row.age_classification === "string" ? row.age_classification : undefined,
    sex: String(row.sex ?? ""),
    address: String(row.complete_address ?? ""),
    barangay: String(row.barangay_name ?? ""),
    barangay_id: row.barangay_id ? String(row.barangay_id) : undefined,
    contact: String(row.contact_number ?? ""),
    street: row.street ? String(row.street) : "",
    family_id: row.family_id ? String(row.family_id) : undefined,
    birth_date: row.birth_date ? String(row.birth_date) : null,
    age_source: row.age_source === "birth_date" && row.age != null ? "birth_date" : row.age_source === "legacy" ? "legacy" : "unavailable",
    is_family_head: Boolean(row.is_family_head),
  };
}

function mapFamily(row: Record<string, unknown>): FamilyRow {
  return {
    family_id: row.family_id ? String(row.family_id) : undefined,
    family_head_id: row.family_head_id ? String(row.family_head_id) : undefined,
    barangay_id: row.barangay_id ? String(row.barangay_id) : undefined,
    familyName: String(row.family_name ?? ""),
    familyHead: String(row.family_head_name ?? ""),
    barangay: String(row.barangay_name ?? ""),
    completeAddress: String(row.complete_address ?? ""),
    street: String(row.street ?? ""),
    pwd: Number(row.pwd_count ?? 0),
    elderly: Number(row.elderly_count ?? 0),
    fourPs: Number(row.four_ps_count ?? 0),
    lactating: Number(row.lactating_count ?? 0),
    pregnant: Number(row.pregnant_count ?? 0),
    infant: Number(row.infant_count ?? 0),
    toddler: Number(row.toddler_count ?? 0),
    totalFamilyMembers: Number(row.total_family_members ?? 0),
  };
}

function residentIsFamilyHead(resident: ResidentRow, family?: FamilyRow) {
  if (family?.family_head_id && resident.resident_id) return family.family_head_id === resident.resident_id;
  return Boolean(resident.is_family_head);
}

function formatClassification(value: string | undefined) {
  switch (value?.toLowerCase()) {
    case "infant": return "Infant";
    case "toddler": return "Toddler";
    case "preschool": return "Preschool / Young Child";
    case "child": return "Child";
    case "teen": return "Teen / Adolescent";
    case "adult": return "Adult";
    case "elderly": return "Senior Citizen / Elderly";
    case "unknown":
    case "unavailable":
    default: return "Unavailable";
  }
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function matchesSearch(search: string, values: unknown[]) {
  const normalizedSearch = normalizeBarangayForCompare(search);
  if (!normalizedSearch) return true;

  return values.some((value) => normalizeBarangayForCompare(String(value ?? "")).includes(normalizedSearch));
}

function canManageResidents(user: StoredSessionUser | null) {
  const role = residentRoleText(user);
  const roleId = Number(user?.role_id);

  if (roleId === 1 || role.includes("super")) return true;
  if (roleId === 4 || role.includes("barangay")) return true;

  return false;
}

function isBarangayUser(user: StoredSessionUser | null) {
  const role = residentRoleText(user);
  return Number(user?.role_id) === 4 || role.includes("barangay");
}

function canViewResidents(user: StoredSessionUser | null) {
  const role = residentRoleText(user);
  const roleId = Number(user?.role_id);

  return (
    roleId === 1
    || roleId === 3
    || roleId === 4
    || role.includes("super")
    || role.includes("cswdd")
    || role.includes("city welfare")
    || role.includes("barangay")
  );
}

function residentRoleText(user: StoredSessionUser | null) {
  const userRecord = (user ?? {}) as StoredSessionUser & { role?: unknown; department?: unknown };
  return [
    userRecord.role,
    userRecord.role_name,
    userRecord.role_label,
    userRecord.department,
  ].map((value) => String(value ?? "")).join(" ").toLowerCase();
}

function Detail({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === "" ? "-" : formatBarangayName(String(value))}</dd>
    </div>
  );
}

function CountField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        value={value}
        onBlur={() => onChange(normalizeWholeNumberInput(value))}
        onChange={(event) => {
          if (/^\d*$/.test(event.target.value)) onChange(event.target.value);
        }}
      />
    </label>
  );
}

function normalizeWholeNumberInput(value: string) {
  if (value === "") return "0";
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.floor(parsed)) : "0";
}

function validateResidentForm(form: ResidentFormState, barangay: { id: string; name: string } | undefined) {
  if (!isValidPersonName(form.last_name)) return "Last name is required and can only contain letters, spaces, apostrophes, hyphens, and periods.";
  if (!isValidPersonName(form.first_name)) return "First name is required and can only contain letters, spaces, apostrophes, hyphens, and periods.";
  if (form.middle_name.trim() && !isValidPersonName(form.middle_name)) return "Middle name can only contain letters, spaces, apostrophes, hyphens, and periods.";
  if (form.suffix.trim() && !/^[A-Za-z0-9 .'-]{1,12}$/.test(form.suffix.trim())) return "Suffix can only contain letters, numbers, spaces, apostrophes, hyphens, and periods.";
  if (!form.age.trim()) return "Age is required.";
  const age = Number(form.age);
  if (!Number.isInteger(age) || age < 0 || age > 120) return "Age must be a whole number from 0 to 120.";
  if (form.sex !== "Male" && form.sex !== "Female") return "Sex must be Male or Female.";
  if (!normalizePhilippineMobile(form.contact_number)) return "Contact number must be a valid Philippine mobile number like +639123456789.";
  if (!form.complete_address.trim()) return "Complete address is required.";
  if (!barangay) return "Barangay is required.";
  if (form.is_family_head) {
    const invalidCount = vulnerabilityCountFields.some((field) => !isValidCount(form[field]));
    if (invalidCount) return "Vulnerability counts must be whole numbers from 0 to 999.";
  }
  return "";
}

function isValidPersonName(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 60 && /^[A-Za-z .'-]+$/.test(trimmed);
}

function isValidCount(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 999;
}

function normalizePhilippineMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  return "";
}

function normalizeBarangay(barangayName: string, barangayId: string) {
  const selected = barangays.find((barangay) => barangay.id === barangayId);
  if (selected) return selected;

  const normalizedName = normalizeBarangayForCompare(barangayName).replace(/^barangay\s+/, "");
  return barangays.find((barangay) => normalizeBarangayForCompare(barangay.name).replace(/^barangay\s+/, "") === normalizedName);
}

function residentFormForUser(user: StoredSessionUser | null): ResidentFormState {
  const barangay = isBarangayUser(user) ? assignedBarangayForUser(user) : null;
  if (!barangay) return emptyResidentForm;

  return {
    ...emptyResidentForm,
    barangay_id: String(barangay.barangay_id),
    barangay_name: barangay.barangay_name,
  };
}

function filterRecordsForUser<T extends { barangay_id?: unknown; barangay?: unknown }>(records: T[], user: StoredSessionUser | null) {
  return isBarangayUser(user) ? records.filter((record) => isSameBarangayForUser(user, record)) : records;
}

function filterRecordsForBarangay<T extends { barangay_id?: unknown; barangay?: unknown; barangay_name?: unknown }>(records: T[], barangayScope?: string) {
  if (!barangayScope) return records;
  const expected = normalizeBarangayForCompare(barangayScope).replace(/^barangay\s+/, "");
  return records.filter((record) => normalizeBarangayForCompare(String(record.barangay_name ?? record.barangay ?? "")).replace(/^barangay\s+/, "") === expected);
}

function buildResidentPayload(form: ResidentFormState, barangay: { id: string; name: string }) {
  const basePayload: Record<string, unknown> = {
    last_name: form.last_name.trim(),
    first_name: form.first_name.trim(),
    middle_name: form.middle_name.trim(),
    suffix: form.suffix.trim(),
    age: form.age ? Number(form.age) : null,
    sex: form.sex.trim(),
    contact_number: normalizePhilippineMobile(form.contact_number),
    complete_address: form.complete_address.trim(),
    street: form.street.trim(),
    barangay_id: Number(barangay.id),
    barangay_name: barangay.name,
    is_family_head: form.is_family_head,
  };

  if (!form.is_family_head) {
    basePayload.selected_family_id = form.selected_family_id;
    basePayload.family_id = form.selected_family_id;
    return basePayload;
  }

  return {
    ...basePayload,
    pwd_count: Number(form.pwd_count || 0),
    elderly_count: Number(form.elderly_count || 0),
    four_ps_count: Number(form.four_ps_count || 0),
    lactating_count: Number(form.lactating_count || 0),
    pregnant_count: Number(form.pregnant_count || 0),
    infant_count: Number(form.infant_count || 0),
    toddler_count: Number(form.toddler_count || 0),
  };
}
