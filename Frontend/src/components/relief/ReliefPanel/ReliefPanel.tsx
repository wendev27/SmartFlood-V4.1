'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { CampaignQrCode } from '@/components/emergency/CampaignQrCode';
import {
  ActionResultModal,
  type ActionResultType,
} from '@/components/ui/ActionResultModal';
import { Button } from '@/components/ui/Button/Button';
import { DataTable } from '@/components/ui/DataTable/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingState } from '@/components/ui/LoadingState';
import type { PageKey } from '@/types/navigation';
import { Modal } from '@/components/ui/Modal/Modal';
import {
  Pagination as SharedPagination,
  type PaginationState,
} from '@/components/ui/Pagination/Pagination';
import {
  formatBarangayName,
  normalizeBarangayForCompare,
} from '@/lib/formatters';
import { queryKeys, queryStaleTime } from '@/lib/queryKeys';
import { getFloodStatusLabel } from '@/lib/statusStyles';
import { closeReliefCampaign } from '@/services/emergencyService';
import {
  approveReliefRecommendationPlan,
  generateReliefRecommendations,
  getCurrentEmergencyAllocation,
  getReliefRecommendations,
  notifyBarangaysForEmergencyAllocation,
  rejectReliefRecommendationPlan,
} from '@/services/reliefService';
import type {
  AhpBreakdown,
  CurrentEmergencyAllocation,
  EmergencyAllocationItem,
  ReliefAllocationPlan,
  ReliefPlanId,
  ReliefRecommendation,
} from '@/types/relief';
import styles from './ReliefPanel.module.css';

type HistoryEntry = ReturnType<typeof mapHistory>;
type HistoryDateFilter = '' | 'all' | 'today' | 'last7' | 'month';
type HistorySort =
  | 'newest'
  | 'oldest'
  | 'barangay'
  | 'food'
  | 'medicine'
  | 'goods';
type GenerationInventoryField =
  | 'family_food_packs'
  | 'medicine_kits'
  | 'relief_goods_individual';
type GenerationPayload = Record<GenerationInventoryField, number>;
type NewAllocationStep = 'idle' | 'closing' | 'generating';

function paginateRecommendations<T>(rows: T[], page: number, limit: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return {
    rows: rows
      .slice(start, start + limit)
      .map((recommendation, index) => ({
        recommendation,
        originalIndex: start + index,
      })),
    pagination: {
      page: safePage,
      limit,
      total: rows.length,
      totalPages,
    } satisfies PaginationState,
  };
}

const generationInventoryDefaults: Record<GenerationInventoryField, string> = {
  family_food_packs: '0',
  medicine_kits: '0',
  relief_goods_individual: '0',
};

const activeCampaignStatuses = new Set([
  'accepted',
  'barangays_notified',
  'in_distribution',
]);
const startNewAllocationClosureReason =
  'Closed to start a new emergency relief allocation recommendation cycle.';

const planCopy: Record<
  ReliefPlanId,
  { focus: string; description: string; button: string }
> = {
  severity_first: {
    focus: 'Flood-focused',
    description:
      'Prioritizes barangays experiencing higher flood severity while considering demographic vulnerability.',
    button: 'Use Severity First',
  },
  vulnerability_first: {
    focus: 'People-focused',
    description:
      'Prioritizes barangays with greater concentrations of vulnerable residents.',
    button: 'Use Vulnerability First',
  },
  balanced: {
    focus: 'Balanced approach',
    description:
      'Balances immediate flood conditions with demographic vulnerability.',
    button: 'Use Balanced',
  },
};

export function ReliefPanel({
  onNavigate,
}: { onNavigate?: (page: PageKey) => void } = {}) {
  const [view, setView] = useState<
    'main' | 'recommendation' | 'history'
  >('main');
  const pageSize = 5;
  const queryClient = useQueryClient();
  const [generationInventory, setGenerationInventory] = useState<
    Record<GenerationInventoryField, string>
  >(generationInventoryDefaults);
  const [isGenerationOpen, setIsGenerationOpen] = useState(false);
  const [selectedReport, setSelectedReport] =
    useState<ReliefRecommendation | null>(null);
  const [generatedPlans, setGeneratedPlans] = useState<ReliefAllocationPlan[]>(
    []
  );
  const [selectedPlanId, setSelectedPlanId] = useState<ReliefPlanId | ''>('');
  const [historyDateFilter, setHistoryDateFilter] =
    useState<HistoryDateFilter>('');
  const [historyBarangayFilter, setHistoryBarangayFilter] = useState('');
  const [historySort, setHistorySort] = useState<HistorySort>('newest');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [currentAllocationPage, setCurrentAllocationPage] = useState(1);
  const [selectedRecommendationPage, setSelectedRecommendationPage] =
    useState(1);
  const [actionError, setActionError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCheckingActiveAllocation, setIsCheckingActiveAllocation] =
    useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isNotifyingBarangays, setIsNotifyingBarangays] = useState(false);
  const [isNewAllocationConfirmOpen, setIsNewAllocationConfirmOpen] =
    useState(false);
  const [pendingGenerationPayload, setPendingGenerationPayload] =
    useState<GenerationPayload | null>(null);
  const [confirmedClosureBatchId, setConfirmedClosureBatchId] = useState<
    string | null
  >(null);
  const [newAllocationStep, setNewAllocationStep] =
    useState<NewAllocationStep>('idle');
  const [resultModal, setResultModal] = useState<{
    open: boolean;
    type: ActionResultType;
    title: string;
    description: string;
    details: string;
    qrToken?: string;
  }>({
    open: false,
    type: 'success' as ActionResultType,
    title: '',
    description: '',
    details: '',
  });
  const recommendationsQuery = useQuery({
    queryKey: queryKeys.relief.recommendations,
    queryFn: getReliefRecommendations,
    staleTime: queryStaleTime.operational,
  });
  const currentAllocationQuery = useQuery({
    queryKey: queryKeys.relief.currentAllocation,
    queryFn: getCurrentEmergencyAllocation,
    staleTime: queryStaleTime.operational,
  });
  const recommendationRows = recommendationsQuery.data ?? [];
  const history = useMemo(
    () => recommendationRows.map(mapHistory),
    [recommendationRows]
  );
  const currentEmergencyAllocation = currentAllocationQuery.data ?? null;
  const loadError = recommendationsQuery.error ?? currentAllocationQuery.error;
  const error =
    actionError ||
    (loadError instanceof Error
      ? loadError.message
      : loadError
        ? 'Unable to load relief data.'
        : '');
  const isLoading =
    recommendationsQuery.isPending || currentAllocationQuery.isPending;
  const isBackgroundRefreshing =
    !isLoading &&
    (recommendationsQuery.isFetching || currentAllocationQuery.isFetching);

  const invalidateReliefWorkflow = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.relief.recommendations,
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.relief.currentAllocation,
      }),
      queryClient.invalidateQueries({ queryKey: queryKeys.relief.campaigns }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.emergency,
      }),
    ]);
  };

  const activeHistoryDateFilter =
    historyDateFilter || defaultHistoryDateFilter(history);
  const selectedPlan = useMemo(
    () =>
      generatedPlans.find((plan) => plan.plan_id === selectedPlanId) ?? null,
    [generatedPlans, selectedPlanId]
  );
  const selectedRecommendations = useMemo(
    () =>
      selectedPlan?.allocations.map((allocation, index) =>
        mapRecommendation(
          allocation as Record<string, unknown>,
          index,
          selectedPlan
        )
      ) ?? [],
    [selectedPlan]
  );
  const currentAllocationRecommendations = useMemo(
    () =>
      currentEmergencyAllocation?.items.map(mapEmergencyAllocationItem) ?? [],
    [currentEmergencyAllocation]
  );
  const paginatedCurrentAllocationRecommendations = useMemo(
    () =>
      paginateRecommendations(
        currentAllocationRecommendations,
        currentAllocationPage,
        pageSize
      ),
    [currentAllocationPage, currentAllocationRecommendations]
  );
  const paginatedSelectedRecommendations = useMemo(
    () =>
      paginateRecommendations(
        selectedRecommendations,
        selectedRecommendationPage,
        pageSize
      ),
    [selectedRecommendationPage, selectedRecommendations]
  );
  const hasActiveCampaign = Boolean(
    currentEmergencyAllocation &&
    isActiveCampaignStatus(currentEmergencyAllocation.status)
  );
  const historyBarangays = useMemo(
    () =>
      Array.from(
        new Set(history.map((entry) => entry.barangay).filter(Boolean))
      ).sort(),
    [history]
  );
  const filteredHistory = useMemo(() => {
    const normalizedSearch = normalizeBarangayForCompare(historySearch);

    return history
      .filter((entry) => {
        const searchable = [
          entry.recommendation_id,
          entry.id,
          entry.date,
          entry.time,
          entry.barangay_name,
          entry.barangay,
          entry.familyFoodPacks,
          entry.medicineKits,
          entry.reliefForIndividual,
        ].join(' ');

        return (
          isInDateFilter(entry.createdAt, activeHistoryDateFilter) &&
          (!historyBarangayFilter ||
            normalizeBarangayForCompare(entry.barangay) ===
              normalizeBarangayForCompare(historyBarangayFilter)) &&
          (!normalizedSearch ||
            normalizeBarangayForCompare(searchable).includes(normalizedSearch))
        );
      })
      .sort((a, b) => sortHistoryEntries(a, b, historySort));
  }, [
    activeHistoryDateFilter,
    history,
    historyBarangayFilter,
    historySearch,
    historySort,
  ]);

  const paginatedHistory = useMemo(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(filteredHistory.length / pageSize)
    );
    const safePage = Math.min(historyPage, totalPages);
    return {
      rows: filteredHistory.slice(
        (safePage - 1) * pageSize,
        safePage * pageSize
      ),
      pagination: {
        page: safePage,
        limit: pageSize,
        total: filteredHistory.length,
        totalPages,
      } satisfies PaginationState,
    };
  }, [filteredHistory, historyPage]);

  useEffect(() => {
    setHistoryPage(1);
  }, [
    activeHistoryDateFilter,
    historyBarangayFilter,
    historySearch,
    historySort,
  ]);

  useEffect(() => {
    if (historyPage !== paginatedHistory.pagination.page)
      setHistoryPage(paginatedHistory.pagination.page);
  }, [historyPage, paginatedHistory.pagination.page]);

  useEffect(() => {
    setCurrentAllocationPage(1);
  }, [currentEmergencyAllocation?.batch_id]);

  useEffect(() => {
    setSelectedRecommendationPage(1);
  }, [selectedPlanId]);

  useEffect(() => {
    if (
      currentAllocationPage !==
      paginatedCurrentAllocationRecommendations.pagination.page
    )
      setCurrentAllocationPage(
        paginatedCurrentAllocationRecommendations.pagination.page
      );
  }, [
    currentAllocationPage,
    paginatedCurrentAllocationRecommendations.pagination.page,
  ]);

  useEffect(() => {
    if (
      selectedRecommendationPage !==
      paginatedSelectedRecommendations.pagination.page
    )
      setSelectedRecommendationPage(
        paginatedSelectedRecommendations.pagination.page
      );
  }, [
    paginatedSelectedRecommendations.pagination.page,
    selectedRecommendationPage,
  ]);

  function resetHistoryFilters() {
    setHistoryDateFilter(defaultHistoryDateFilter(history));
    setHistoryBarangayFilter('');
    setHistorySort('newest');
    setHistorySearch('');
    setHistoryPage(1);
  }

  async function openGenerationWorkflow() {
    setIsCheckingActiveAllocation(true);
    setActionError('');
    setPendingGenerationPayload(null);
    setConfirmedClosureBatchId(null);
    setIsNewAllocationConfirmOpen(false);
    setIsGenerationOpen(false);
    try {
      const latestActiveAllocation = await queryClient.fetchQuery({
        queryKey: queryKeys.relief.currentAllocation,
        queryFn: getCurrentEmergencyAllocation,
        staleTime: queryStaleTime.operational,
      });
      queryClient.setQueryData(
        queryKeys.relief.currentAllocation,
        latestActiveAllocation
      );

      if (
        latestActiveAllocation &&
        isActiveCampaignStatus(latestActiveAllocation.status)
      ) {
        setGenerationInventory(generationInventoryDefaults);
        setIsNewAllocationConfirmOpen(true);
        return;
      }

      openGenerationModal();
    } catch (activeCheckError) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Unable to Check Active Allocation',
        description:
          activeCheckError instanceof Error
            ? activeCheckError.message
            : 'Unable to confirm whether a relief allocation is active.',
        details:
          'No campaign was closed and no new recommendation was generated. Please try again after the current allocation state loads.',
      });
    } finally {
      setIsCheckingActiveAllocation(false);
    }
  }

  function openGenerationModal() {
    setGenerationInventory(generationInventoryDefaults);
    setIsGenerationOpen(true);
  }

  function closeGenerationModal() {
    setIsGenerationOpen(false);
    setGenerationInventory(generationInventoryDefaults);
    setConfirmedClosureBatchId(null);
  }

  function updateGenerationQuantity(
    field: GenerationInventoryField,
    value: string
  ) {
    if (!/^\d*$/.test(value)) return;
    setGenerationInventory((current) => ({ ...current, [field]: value }));
  }

  function normalizeGenerationQuantity(field: GenerationInventoryField) {
    setGenerationInventory((current) => ({
      ...current,
      [field]: String(parseWholeNumber(current[field])),
    }));
  }

  async function submitGeneration() {
    const payload = {
      family_food_packs: parseWholeNumber(
        generationInventory.family_food_packs
      ),
      medicine_kits: parseWholeNumber(generationInventory.medicine_kits),
      relief_goods_individual: parseWholeNumber(
        generationInventory.relief_goods_individual
      ),
    };

    if (!hasAnyInventory(payload)) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Relief Inventory Required',
        description:
          'Please input available relief inventory before generating recommendations.',
        details: 'At least one inventory value must be greater than 0.',
      });
      return;
    }

    setActionError('');
    setIsGenerating(true);
    try {
      const latestActiveAllocation = await queryClient.fetchQuery({
        queryKey: queryKeys.relief.currentAllocation,
        queryFn: getCurrentEmergencyAllocation,
        staleTime: queryStaleTime.operational,
      });
      queryClient.setQueryData(
        queryKeys.relief.currentAllocation,
        latestActiveAllocation
      );

      if (
        latestActiveAllocation &&
        isActiveCampaignStatus(latestActiveAllocation.status)
      ) {
        if (confirmedClosureBatchId === latestActiveAllocation.batch_id) {
          await closeAndGenerate(latestActiveAllocation, payload);
          return;
        }

        setPendingGenerationPayload(payload);
        setIsGenerationOpen(false);
        setIsNewAllocationConfirmOpen(true);
        return;
      }

      setConfirmedClosureBatchId(null);
      await runGeneration(payload, { manageLoading: false });
    } catch (activeCheckError) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Unable to Check Active Allocation',
        description:
          activeCheckError instanceof Error
            ? activeCheckError.message
            : 'Unable to confirm whether a relief allocation is active.',
        details:
          'No campaign was closed and no new recommendation was generated. Please try again after the current allocation state loads.',
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function runGeneration(
    payload: GenerationPayload,
    options: { manageLoading?: boolean; closedPreviousCampaign?: boolean } = {}
  ) {
    const shouldManageLoading = options.manageLoading !== false;
    if (shouldManageLoading) setIsGenerating(true);
    setActionError('');
    try {
      const generatedRows = await generateReliefRecommendations(payload);
      const plans = normalizePlans(generatedRows.plans);
      setGeneratedPlans(plans);
      setSelectedPlanId('');
      setSelectedReport(null);
      setIsGenerationOpen(false);

      let refreshError = '';
      try {
        const latestRows = await getReliefRecommendations();
        queryClient.setQueryData(queryKeys.relief.recommendations, latestRows);
        await invalidateReliefWorkflow();
      } catch (error) {
        refreshError =
          error instanceof Error
            ? error.message
            : 'Unable to refresh allocation history.';
        void queryClient.invalidateQueries({
          queryKey: queryKeys.relief.recommendations,
        });
      }

      setResultModal({
        open: true,
        type: 'success',
        title: 'Allocation Plans Generated',
        description: options.closedPreviousCampaign
          ? 'The previous active allocation was closed and SmartFlood generated a new draft strategy set.'
          : 'SmartFlood generated three AI allocation strategies.',
        details: refreshError
          ? `Choose an allocation strategy to review. The history list could not refresh yet: ${refreshError}`
          : plans.length > 0
            ? 'Choose an allocation strategy to review. No new campaign is accepted or sent until you explicitly accept a strategy.'
            : 'No strategy plans were returned by the backend.',
      });
      return true;
    } catch (generateError) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Failed to Generate Recommendation',
        description:
          generateError instanceof Error
            ? generateError.message
            : 'Unable to generate recommendations',
        details: options.closedPreviousCampaign
          ? 'The previous campaign was already closed and its historical records were preserved. No new allocation batch was fabricated.'
          : 'Please verify the entered inventory, sensor data, and resident data before trying again.',
      });
      return false;
    } finally {
      if (shouldManageLoading) setIsGenerating(false);
    }
  }

  async function confirmCloseAndGenerate() {
    if (!currentEmergencyAllocation || !pendingGenerationPayload) return;

    const campaignToClose = currentEmergencyAllocation;
    const payload = pendingGenerationPayload;

    await closeAndGenerate(campaignToClose, payload);
  }

  async function closeAndGenerate(
    campaignToClose: CurrentEmergencyAllocation,
    payload: GenerationPayload
  ) {
    setNewAllocationStep('closing');
    setIsGenerating(true);
    setActionError('');
    try {
      await closeReliefCampaign(
        campaignToClose.batch_id,
        startNewAllocationClosureReason
      );
      queryClient.setQueryData(queryKeys.relief.currentAllocation, null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.relief.campaigns,
      });
      setNewAllocationStep('generating');
      const generated = await runGeneration(payload, {
        manageLoading: false,
        closedPreviousCampaign: true,
      });
      setIsNewAllocationConfirmOpen(false);
      setPendingGenerationPayload(null);
      setConfirmedClosureBatchId(null);
      if (!generated) {
        const latestActiveAllocation = await getCurrentEmergencyAllocation();
        queryClient.setQueryData(
          queryKeys.relief.currentAllocation,
          latestActiveAllocation
        );
      }
    } catch (closeError) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Current Allocation Was Not Closed',
        description:
          closeError instanceof Error
            ? closeError.message
            : 'Unable to close the current relief allocation.',
        details:
          'No new AI recommendation was generated. The active campaign and its records were left untouched.',
      });
    } finally {
      setNewAllocationStep('idle');
      setIsGenerating(false);
    }
  }

  function confirmStartNewAllocationCycle() {
    if (!currentEmergencyAllocation || newAllocationStep !== 'idle') return;
    setConfirmedClosureBatchId(currentEmergencyAllocation.batch_id);
    setIsNewAllocationConfirmOpen(false);
    setPendingGenerationPayload(null);
    openGenerationModal();
  }

  function confirmNewAllocationAction() {
    if (pendingGenerationPayload) {
      void confirmCloseAndGenerate();
      return;
    }
    confirmStartNewAllocationCycle();
  }

  function cancelNewAllocation() {
    if (newAllocationStep !== 'idle') return;
    setIsNewAllocationConfirmOpen(false);
    setPendingGenerationPayload(null);
    setConfirmedClosureBatchId(null);
    setGenerationInventory(generationInventoryDefaults);
  }

  async function acceptSelectedPlan() {
    if (!selectedPlan) return;

    setIsApproving(true);
    setActionError('');
    try {
      const workflow = await approveReliefRecommendationPlan(
        selectedPlan as unknown as Record<string, unknown>
      );
      const savedRows = Array.isArray(workflow.data) ? workflow.data : [];
      const [latestRows, currentAllocation] = await Promise.all([
        savedRows.length > 0
          ? Promise.resolve(savedRows)
          : getReliefRecommendations(),
        getCurrentEmergencyAllocation(),
      ]);
      queryClient.setQueryData(queryKeys.relief.recommendations, latestRows);
      queryClient.setQueryData(
        queryKeys.relief.currentAllocation,
        currentAllocation
      );
      await invalidateReliefWorkflow();
      setGeneratedPlans([]);
      setSelectedPlanId('');
      setSelectedReport(null);
      setResultModal({
        open: true,
        type: 'success',
        title: 'Recommendation Accepted',
        qrToken: workflow.qr_token,
        description: `${selectedPlan.plan_name} was recorded in allocation history.`,
        details: workflow.batch_id
          ? `Emergency allocation batch ${shortenId(workflow.batch_id)} was created for Phase 1 review.`
          : 'The selected strategy is now saved for review in the allocation history table.',
      });
    } catch (approvalError) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Failed to Accept Recommendation',
        description:
          approvalError instanceof Error
            ? approvalError.message
            : 'Unable to save the selected recommendation.',
        details:
          'Please verify the backend service and try accepting the strategy again.',
      });
    } finally {
      setIsApproving(false);
    }
  }

  function declineGeneratedPlans() {
    void rejectSelectedPlan();
  }

  async function rejectSelectedPlan() {
    if (!selectedPlan) {
      setGeneratedPlans([]);
      setSelectedPlanId('');
      setSelectedReport(null);
      return;
    }

    setIsApproving(true);
    setActionError('');
    try {
      const workflow = await rejectReliefRecommendationPlan(
        selectedPlan as unknown as Record<string, unknown>
      );
      const currentAllocation = await getCurrentEmergencyAllocation();
      queryClient.setQueryData(
        queryKeys.relief.currentAllocation,
        currentAllocation
      );
      await invalidateReliefWorkflow();
      setGeneratedPlans([]);
      setSelectedPlanId('');
      setSelectedReport(null);
      setResultModal({
        open: true,
        type: 'success',
        title: 'Recommendation Rejected',
        description: `${selectedPlan.plan_name} was rejected.`,
        details: workflow.batch_id
          ? `Rejected emergency allocation batch ${shortenId(workflow.batch_id)} was recorded.`
          : 'The generated allocation plans were discarded.',
      });
    } catch (rejectError) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Failed to Reject Recommendation',
        description:
          rejectError instanceof Error
            ? rejectError.message
            : 'Unable to reject the selected recommendation.',
        details:
          'Please verify the backend service and try rejecting the strategy again.',
      });
    } finally {
      setIsApproving(false);
    }
  }

  async function notifyBarangays() {
    if (
      !currentEmergencyAllocation ||
      currentEmergencyAllocation.status !== 'accepted'
    )
      return;

    setIsNotifyingBarangays(true);
    setActionError('');
    try {
      const response = await notifyBarangaysForEmergencyAllocation(
        currentEmergencyAllocation.batch_id
      );
      if (response.data) {
        queryClient.setQueryData(
          queryKeys.relief.currentAllocation,
          response.data
        );
      } else {
        queryClient.setQueryData(
          queryKeys.relief.currentAllocation,
          await getCurrentEmergencyAllocation()
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.relief.currentAllocation,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.notifications.emergency,
        }),
      ]);
      setResultModal({
        open: true,
        type: 'success',
        title: response.already_notified
          ? 'Barangays Already Notified'
          : 'Barangays Notified',
        description: response.already_notified
          ? 'The emergency allocation batch had already been sent to barangays.'
          : 'Barangay allocation notifications were created successfully.',
        details: `Notifications created: ${response.notifications_created ?? 0}.`,
      });
    } catch (notifyError) {
      setResultModal({
        open: true,
        type: 'error',
        title: 'Failed to Notify Barangays',
        description:
          notifyError instanceof Error
            ? notifyError.message
            : 'Unable to create barangay notifications.',
        details:
          'The active allocation state was preserved. Please verify the workflow state and try again.',
      });
    } finally {
      setIsNotifyingBarangays(false);
    }
  }

  return (
    <>
      {view === 'main' ? (
        <nav
          className={styles.moduleGrid}
          aria-label="Relief recommendation views"
        >
          <button
            className={styles.moduleCard}
            type="button"
            onClick={() => setView('recommendation')}
          >
            <span className={styles.moduleIcon}>
              <img src="/images/cswdd/relief-recommendation.svg" alt="" />
            </span>
            <h2>AI-Optimized Relief Recommendation</h2>
          </button>
          <button
            className={styles.moduleCard}
            type="button"
            onClick={() => setView('history')}
          >
            <span className={styles.moduleIcon}>
              <img src="/images/cswdd/recommendation-history.svg" alt="" />
            </span>
            <h2>Recommendation History</h2>
          </button>
          <button
            className={styles.moduleCard}
            type="button"
            disabled={!onNavigate}
            onClick={() => onNavigate?.('reliefDistribution')}
          >
            <span className={styles.moduleIcon}>
              <img src="/images/cswdd/distribution-list.svg" alt="" />
            </span>
            <h2>Relief Distribution List</h2>
          </button>
        </nav>
      ) : (
        <>
          <button
            className={styles.backButton}
            type="button"
            onClick={() => setView('main')}
          >
            ← Back
          </button>
          {view === 'recommendation' ? (
            <h1 className={styles.recommendationPageTitle}>
              AI-Optimized Relief Recommendation
            </h1>
          ) : null}
        </>
      )}
      <section
        hidden={view === 'main'}
        className={`${styles.stack} ${view === 'history' ? styles.historyMode : styles.recommendationMode}`}
        aria-label="AI relief recommendations"
      >
        <div
          hidden={view !== 'recommendation'}
          className={`${styles.panel} ${styles.historyPanel}`}
        >
          <div className={styles.panelHeader}>
            <div>
              <h3>AI Allocation Suggestions</h3>
              <p>
                {currentEmergencyAllocation
                  ? 'Review the persisted emergency allocation workflow.'
                  : generatedPlans.length > 0
                    ? 'Choose how SmartFlood should prioritize relief allocation.'
                    : 'Generate AI allocation plans from current flood data and available inventory.'}
              </p>
            </div>
            {generatedPlans.length === 0 ? (
              <div className={styles.actions}>
                <Button
                  className={styles.actionButton}
                  onClick={openGenerationWorkflow}
                  disabled={isGenerating || isCheckingActiveAllocation}
                >
                  {isGenerating
                    ? 'Generating...'
                    : isCheckingActiveAllocation
                      ? 'Checking...'
                      : hasActiveCampaign
                        ? 'Generate New Recommendation'
                        : 'Generate Recommendation'}
                </Button>
              </div>
            ) : null}
          </div>
          {error ? (
            <ErrorState title="Unable to Load Relief Data" message={error} />
          ) : null}
          {isLoading ? <LoadingState message="Loading relief data..." /> : null}
          {isBackgroundRefreshing ? (
            <p className={styles.stateMessage}>Refreshing relief data...</p>
          ) : null}

          {isCheckingActiveAllocation ? (
            <p className={styles.stateMessage}>
              Checking current allocation...
            </p>
          ) : null}
          {isGenerating ? (
            <p className={styles.stateMessage}>
              {newAllocationStep === 'closing'
                ? 'Ending current allocation...'
                : 'Generating AI allocation plans...'}
            </p>
          ) : null}

          {!isLoading && !isGenerating && currentEmergencyAllocation ? (
            <section
              className={styles.activeAllocation}
              aria-label="Active emergency allocation"
            >
              <div className={styles.activeAllocationHeader}>
                <div>
                  <span>Active Emergency Allocation</span>
                  <h4>{currentEmergencyAllocation.plan_name}</h4>
                  <p>
                    Status:{' '}
                    {formatWorkflowStatus(currentEmergencyAllocation.status)}
                  </p>
                </div>
                {currentEmergencyAllocation.status === 'accepted' ? (
                  <button
                    className={styles.notifyButton}
                    type="button"
                    disabled={isNotifyingBarangays}
                    onClick={notifyBarangays}
                  >
                    {isNotifyingBarangays ? 'Notifying...' : 'Notify Barangays'}
                  </button>
                ) : currentEmergencyAllocation.status ===
                  'barangays_notified' ? (
                  <button
                    className={styles.notifyButton}
                    type="button"
                    disabled
                  >
                    Barangays Notified
                  </button>
                ) : null}
              </div>
              <div className={styles.recommendationList}>
                {paginatedCurrentAllocationRecommendations.rows.map(
                  ({ recommendation, originalIndex }) => (
                    <article
                      className={styles.recommendationCard}
                      key={
                        recommendation.recommendation_id ||
                        `${recommendation.barangay}-${originalIndex}`
                      }
                      onClick={() => setSelectedReport(recommendation)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedReport(recommendation);
                        }
                      }}
                      aria-label={`View active allocation for ${formatBarangayName(recommendation.barangay)}`}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.rank}>{recommendation.id}</span>
                        <h4>{formatBarangayName(recommendation.barangay)}</h4>
                        <button
                          className={styles.viewButton}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedReport(recommendation);
                          }}
                        >
                          View Analysis
                        </button>
                      </div>
                      <div className={styles.cardDetails}>
                        <div>
                          <span>Barangay Status</span>
                          <p>
                            {formatWorkflowStatus(
                              String(
                                currentEmergencyAllocation.items[originalIndex]
                                  ?.barangay_status ?? 'pending'
                              )
                            )}
                          </p>
                        </div>
                        <div>
                          <span>Active Allocation</span>
                          <p>{recommendation.recommendedItems}</p>
                        </div>
                      </div>
                    </article>
                  )
                )}
              </div>
              <SharedPagination
                pagination={
                  paginatedCurrentAllocationRecommendations.pagination
                }
                onPageChange={setCurrentAllocationPage}
                label="Active allocation barangays"
              />
            </section>
          ) : null}

          {!isLoading && !isGenerating && generatedPlans.length > 0 ? (
            <section
              className={styles.strategySection}
              aria-label="Allocation strategy selection"
            >
              {!selectedPlan ? (
                <>
                  <div className={styles.strategyIntro}>
                    <h4>Plans generated successfully.</h4>
                    <p>Choose an allocation strategy to review.</p>
                  </div>
                  <div className={styles.strategyGrid}>
                    {generatedPlans.map((plan) => (
                      <StrategyCard
                        key={plan.plan_id}
                        plan={plan}
                        isSelected={selectedPlanId === plan.plan_id}
                        onSelect={() => setSelectedPlanId(plan.plan_id)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.selectedStrategyHeader}>
                    <div>
                      <span>Selected Strategy</span>
                      <h4>{selectedPlan.plan_name}</h4>
                    </div>
                    <div
                      className={styles.strategyTabs}
                      aria-label="Switch allocation strategy"
                    >
                      {generatedPlans.map((plan) => (
                        <button
                          key={plan.plan_id}
                          className={
                            selectedPlanId === plan.plan_id
                              ? styles.activeStrategyTab
                              : ''
                          }
                          type="button"
                          onClick={() => setSelectedPlanId(plan.plan_id)}
                        >
                          {plan.plan_name}
                        </button>
                      ))}
                    </div>
                    <div className={styles.decisionActions}>
                      <button
                        type="button"
                        className={styles.declineButton}
                        onClick={declineGeneratedPlans}
                        disabled={isApproving}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className={styles.acceptButton}
                        onClick={acceptSelectedPlan}
                        disabled={isApproving}
                      >
                        {isApproving ? 'Saving...' : 'Accept Strategy'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {selectedPlan ? (
            <>
              <div className={styles.recommendationList}>
                {paginatedSelectedRecommendations.rows.map(
                  ({ recommendation, originalIndex }) => (
                    <article
                      className={styles.recommendationCard}
                      key={
                        recommendation.recommendation_id ||
                        `${recommendation.barangay_name ?? recommendation.barangay}-${originalIndex}`
                      }
                      onClick={() => setSelectedReport(recommendation)}
                      tabIndex={0}
                      role="button"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedReport(recommendation);
                        }
                      }}
                      aria-label={`View full report for ${formatBarangayName(recommendation.barangay)}`}
                    >
                      <div className={styles.cardTop}>
                        <span className={styles.rank}>{recommendation.id}</span>
                        <h4>{formatBarangayName(recommendation.barangay)}</h4>
                        <button
                          className={styles.viewButton}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedReport(recommendation);
                          }}
                        >
                          View Analysis
                        </button>
                      </div>
                      <div className={styles.cardDetails}>
                        <div>
                          <span>Recommended Allocation</span>
                          <p>{recommendation.recommendedItems}</p>
                        </div>
                        <div>
                          <span>Analysis Reason</span>
                          <p>
                            {formatBarangayName(recommendation.analysisReason)}
                          </p>
                        </div>
                      </div>
                    </article>
                  )
                )}
              </div>
              <SharedPagination
                pagination={paginatedSelectedRecommendations.pagination}
                onPageChange={setSelectedRecommendationPage}
                label="Selected strategy barangays"
              />
            </>
          ) : null}

          {!isLoading &&
          !isGenerating &&
          generatedPlans.length === 0 &&
          !currentEmergencyAllocation ? (
            <section
              className={styles.noStrategyPage}
              aria-label="No ongoing relief strategy"
            >
              <div className={styles.noStrategyIcon} aria-hidden="true">
                <img src="/images/cswdd/relief-recommendation.svg" alt="" />
              </div>
              <span>No ongoing strategy</span>
              <h2>Create an AI-Optimized Relief Strategy</h2>
              <p>
                Enter the available relief inventory, then review the generated
                strategies and barangay allocations.
              </p>
              <button
                type="button"
                onClick={openGenerationWorkflow}
                disabled={isCheckingActiveAllocation}
              >
                <img src="/images/cswdd/input-relief.svg" alt="" />
                Input Available Relief
              </button>
              <div className={styles.noStrategySteps}>
                <div>
                  <strong>1</strong>
                  <span>Enter available inventory</span>
                </div>
                <div>
                  <strong>2</strong>
                  <span>Review generated strategies</span>
                </div>
                <div>
                  <strong>3</strong>
                  <span>Accept and notify barangays</span>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <div hidden={view !== 'history'} className={styles.panel}>
          {error ? (
            <ErrorState title="Unable to Load Relief Data" message={error} />
          ) : null}
          {isLoading ? (
            <LoadingState message="Loading recommendation history..." />
          ) : null}
          <div className={styles.historyHeader}>
            <h3>Allocation History</h3>
            <p>View generated relief allocation recommendations</p>
          </div>
          <div
            className={styles.historyFilters}
            aria-label="Allocation history filters"
          >
            <label>
              <span>Date</span>
              <select
                value={activeHistoryDateFilter}
                onChange={(event) =>
                  setHistoryDateFilter(event.target.value as HistoryDateFilter)
                }
              >
                <option value="all">All dates</option>
                <option value="today">Today</option>
                <option value="last7">Last 7 days</option>
                <option value="month">This month</option>
              </select>
            </label>
            <label>
              <span>Barangay</span>
              <select
                value={historyBarangayFilter}
                onChange={(event) =>
                  setHistoryBarangayFilter(event.target.value)
                }
              >
                <option value="">All barangays</option>
                {historyBarangays.map((barangay) => (
                  <option key={barangay} value={barangay}>
                    {formatBarangayName(barangay)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select
                value={historySort}
                onChange={(event) =>
                  setHistorySort(event.target.value as HistorySort)
                }
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="barangay">Barangay A-Z</option>
                <option value="food">Highest Family Food Packs</option>
                <option value="medicine">Highest Medicine Kits</option>
                <option value="goods">Highest Relief Goods</option>
              </select>
            </label>
            <label className={styles.historySearch}>
              <span>Search</span>
              <input
                type="search"
                placeholder="Search ID, date, barangay, or goods..."
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
              />
            </label>
            <button type="button" onClick={resetHistoryFilters}>
              Reset
            </button>
          </div>
          <div className={styles.historyTableWrap}>
            <DataTable
              headers={[
                'Allocation ID',
                'Date',
                'Time',
                'Barangay',
                'Family Food Packs',
                'Medicine Kits',
                'Relief for Individual',
              ]}
              minWidth={760}
            >
              {paginatedHistory.rows.map((entry) => (
                <tr key={entry.recommendation_id}>
                  <td title={entry.recommendation_id}>{entry.id}</td>
                  <td>{entry.date}</td>
                  <td>{entry.time}</td>
                  <td>{formatBarangayName(entry.barangay)}</td>
                  <td>{entry.familyFoodPacks}</td>
                  <td>{entry.medicineKits}</td>
                  <td>{entry.reliefForIndividual}</td>
                </tr>
              ))}
              {!isLoading && filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title={
                        history.length === 0
                          ? 'No allocation history yet.'
                          : 'No allocation history matches your filters.'
                      }
                      description={
                        history.length === 0
                          ? 'Generated allocation recommendations will appear here.'
                          : 'Try changing the date, barangay, sort, or search filters.'
                      }
                    />
                  </td>
                </tr>
              ) : null}
            </DataTable>
          </div>
          <SharedPagination
            pagination={paginatedHistory.pagination}
            onPageChange={setHistoryPage}
            label="Allocation history"
          />
        </div>
      </section>

      <Modal
        className={`${styles.inventoryDialog} ${styles.cswddInventoryDialog}`}
        backdropClassName={styles.cswddBackdrop}
        isOpen={isGenerationOpen}
        labelledBy="generate-relief-title"
        onClose={closeGenerationModal}
      >
        <header className={styles.modalHeader}>
          <div>
            <h3 id="generate-relief-title">Input Available Relief</h3>
            <p>
              Input current available relief inventory to calculate recommended
              allocation.
            </p>
          </div>
          <button
            className={styles.closeButtonLight}
            type="button"
            onClick={closeGenerationModal}
            aria-label="Close"
          >
            <img src="/images/cswdd/close-square.svg" alt="" />
          </button>
        </header>
        <div className={styles.inventoryBody}>
          <div className={styles.inventoryList}>
            <GenerationQuantityField
              label="Family Food Packs"
              icon="/images/cswdd/food-pack.svg"
              unit="packs"
              value={generationInventory.family_food_packs}
              onBlur={() => normalizeGenerationQuantity('family_food_packs')}
              onChange={(value) =>
                updateGenerationQuantity('family_food_packs', value)
              }
            />
            <GenerationQuantityField
              label="Medicine Kits"
              icon="/images/cswdd/medicine-kit.svg"
              unit="kits"
              value={generationInventory.medicine_kits}
              onBlur={() => normalizeGenerationQuantity('medicine_kits')}
              onChange={(value) =>
                updateGenerationQuantity('medicine_kits', value)
              }
            />
            <GenerationQuantityField
              label="Relief Goods for Individual"
              icon="/images/cswdd/relief-goods.svg"
              unit="pcs"
              value={generationInventory.relief_goods_individual}
              onBlur={() =>
                normalizeGenerationQuantity('relief_goods_individual')
              }
              onChange={(value) =>
                updateGenerationQuantity('relief_goods_individual', value)
              }
            />
          </div>
          <div className={styles.modalFooter}>
            <Button
              className={styles.footerButton}
              tone="muted"
              onClick={closeGenerationModal}
            >
              Cancel
            </Button>
            <Button
              className={styles.footerButton}
              onClick={submitGeneration}
              disabled={isGenerating}
            >
              {isGenerating ? 'Generating...' : 'Generate Recommendation'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        className={`${styles.confirmDialog} ${styles.cswddConfirmDialog}`}
        backdropClassName={styles.cswddBackdrop}
        isOpen={isNewAllocationConfirmOpen}
        labelledBy="new-relief-allocation-title"
        onClose={cancelNewAllocation}
      >
        <header className={styles.modalHeader}>
          <div>
            <h3 id="new-relief-allocation-title">
              Start New Relief Allocation?
            </h3>
            <p>A relief allocation is currently active.</p>
          </div>
          <button
            className={styles.closeButtonLight}
            type="button"
            onClick={cancelNewAllocation}
            disabled={newAllocationStep !== 'idle'}
            aria-label="Close"
          >
            <img src="/images/cswdd/close-square.svg" alt="" />
          </button>
        </header>
        <div className={styles.confirmBody}>
          <div className={styles.currentCampaignSummary}>
            <div>
              <span>Current Strategy</span>
              <strong>
                {currentEmergencyAllocation?.plan_name ?? 'Active allocation'}
              </strong>
            </div>
            <div>
              <span>Current Status</span>
              <strong>
                {formatWorkflowStatus(currentEmergencyAllocation?.status ?? '')}
              </strong>
            </div>
          </div>
          <p>
            Starting a new relief allocation will close the current relief
            campaign according to the existing workflow and begin a new AI
            recommendation cycle. Existing distribution records, barangay
            allocations, notifications, historical records, and audit logs will
            not be deleted.
          </p>
          <p>
            The new AI recommendation will remain a draft strategy selection.
            You must still choose and accept Severity First, Vulnerability
            First, or Balanced before barangays can be notified.
          </p>
          {newAllocationStep !== 'idle' ? (
            <p className={styles.stateMessage}>
              {newAllocationStep === 'closing'
                ? 'Ending current allocation...'
                : 'Generating new recommendation...'}
            </p>
          ) : null}
          <div className={styles.modalFooter}>
            <Button
              className={styles.footerButton}
              tone="muted"
              onClick={cancelNewAllocation}
              disabled={newAllocationStep !== 'idle'}
            >
              Cancel
            </Button>
            <Button
              className={styles.footerButton}
              onClick={confirmNewAllocationAction}
              disabled={newAllocationStep !== 'idle' || isGenerating}
            >
              {newAllocationStep === 'closing'
                ? 'Ending Allocation...'
                : newAllocationStep === 'generating'
                  ? 'Generating...'
                  : pendingGenerationPayload
                    ? 'End Current Allocation & Generate New'
                    : 'Continue to Inventory'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        className={`${styles.reportDialog} ${styles.cswddReportDialog}`}
        backdropClassName={styles.cswddBackdrop}
        isOpen={Boolean(selectedReport)}
        labelledBy="barangay-report-title"
        onClose={() => setSelectedReport(null)}
      >
        {selectedReport ? (
          <>
            <header className={styles.reportHeader}>
              <div>
                <h3 id="barangay-report-title">
                  {formatBarangayName(selectedReport.barangay)}
                </h3>
                <p>
                  {selectedReport.selectedPlanName
                    ? `${selectedReport.selectedPlanName} strategy analysis`
                    : 'Comprehensive allocation analysis'}
                </p>
              </div>
              <button
                className={styles.closeButtonDark}
                type="button"
                onClick={() => setSelectedReport(null)}
                aria-label="Close"
              >
                <img src="/images/cswdd/close-square.svg" alt="" />
              </button>
            </header>
            <div className={styles.reportBody}>
              <section className={styles.reportSection}>
                <h4>Recommendation Summary</h4>
                <dl className={styles.reportGrid}>
                  <ReportDetail
                    label="Barangay"
                    value={formatBarangayName(selectedReport.barangay)}
                  />
                  <ReportDetail
                    label="Risk Level"
                    value={selectedReport.riskLevel}
                  />
                  <ReportDetail
                    label="Priority Score"
                    value={formatNumber(selectedReport.priorityScore)}
                  />
                  <ReportDetail
                    label="Flood Water Level"
                    value={formatWaterLevel(
                      selectedReport.waterLevelM ??
                        selectedReport.fuzzyExplanation?.waterLevelM
                    )}
                  />
                  <ReportDetail
                    label="Affected Families"
                    value={selectedReport.affectedFamilies}
                  />
                  <ReportDetail
                    label="Objective Value"
                    value={formatNumber(selectedReport.objectiveValue)}
                  />
                </dl>
              </section>
              <section className={styles.reportSection}>
                <h4>Recommended Allocation</h4>
                <dl className={styles.reportGrid}>
                  <ReportDetail
                    label="Family Food Packs"
                    value={selectedReport.familyFoodPacks}
                  />
                  <ReportDetail
                    label="Individual Relief Goods"
                    value={selectedReport.reliefForIndividual}
                  />
                  <ReportDetail
                    label="Emergency Kits"
                    value={selectedReport.medicineKits}
                  />
                </dl>
              </section>
              <section className={styles.reportSection}>
                <h4>Why This Recommendation?</h4>
                <p>{formatBarangayName(selectedReport.report)}</p>
              </section>
              <section className={styles.reportSection}>
                <h4>Flood Analysis</h4>
                <dl className={styles.reportGrid}>
                  <ReportDetail
                    label="Water Level"
                    value={formatWaterLevel(
                      selectedReport.fuzzyExplanation?.waterLevelM ??
                        selectedReport.waterLevelM
                    )}
                  />
                  <ReportDetail
                    label="Risk"
                    value={
                      selectedReport.fuzzyExplanation?.riskLabel ??
                      selectedReport.riskLevel
                    }
                  />
                  <ReportDetail
                    label="Confidence"
                    value={formatConfidence(
                      selectedReport.fuzzyExplanation?.confidence
                    )}
                  />
                </dl>
                {selectedReport.fuzzyExplanation?.memberships ? (
                  <MetricList
                    title="Membership Values"
                    values={selectedReport.fuzzyExplanation.memberships}
                    formatter={formatConfidence}
                  />
                ) : null}
              </section>
              <section className={styles.reportSection}>
                <h4>Vulnerability Analysis</h4>
                <dl className={styles.reportGrid}>
                  <ReportDetail
                    label="AHP Vulnerability Score"
                    value={formatNumber(selectedReport.ahpVulnerabilityScore)}
                  />
                </dl>
                {selectedReport.ahpBreakdown ? (
                  <AhpBreakdownTable breakdown={selectedReport.ahpBreakdown} />
                ) : null}
              </section>
              <section className={styles.reportSection}>
                <h4>Optimization Reasoning</h4>
                <p>
                  The allocation was calculated using Integer Linear
                  Programming. The optimizer maximized priority-weighted
                  resource coverage while respecting available supply, demand
                  limits, and whole-unit allocation requirements.
                </p>
                {selectedReport.demandCeiling ? (
                  <MetricList
                    title="Demand Ceiling"
                    values={selectedReport.demandCeiling}
                  />
                ) : null}
              </section>
              <section className={styles.reportSection}>
                <h4>Constraint Status</h4>
                <dl className={styles.reportGrid}>
                  <ReportDetail
                    label="Supply Constraint"
                    value={
                      selectedReport.constraintsSatisfied === false
                        ? 'Review needed'
                        : 'Satisfied'
                    }
                  />
                  <ReportDetail
                    label="Demand Ceiling"
                    value={
                      selectedReport.constraintsSatisfied === false
                        ? 'Review needed'
                        : 'Satisfied'
                    }
                  />
                  <ReportDetail
                    label="Integer Allocation"
                    value={
                      areAllocationsInteger(selectedReport)
                        ? 'Satisfied'
                        : 'Review needed'
                    }
                  />
                  <ReportDetail
                    label="Non-negative Allocation"
                    value={
                      areAllocationsNonNegative(selectedReport)
                        ? 'Satisfied'
                        : 'Review needed'
                    }
                  />
                </dl>
              </section>
              <section className={styles.reportSection}>
                <h4>Reasoning Steps</h4>
                {(selectedReport.reasoningSteps?.length ?? 0) > 0 ? (
                  <ol className={styles.reasoningList}>
                    {selectedReport.reasoningSteps?.map((step, index) => (
                      <li key={`${index}-${step}`}>
                        {formatBarangayName(step)}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>
                    No detailed reasoning steps were returned for this
                    historical recommendation.
                  </p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </Modal>

      <ActionResultModal
        variant="cswdd"
        open={resultModal.open}
        type={resultModal.type}
        title={resultModal.title}
        description={resultModal.description}
        details={resultModal.details}
        primaryLabel="OK"
        onPrimary={() =>
          setResultModal((current) => ({ ...current, open: false }))
        }
        onClose={() =>
          setResultModal((current) => ({ ...current, open: false }))
        }
      >
        {resultModal.type === 'success' && resultModal.qrToken ? (
          <CampaignQrCode token={resultModal.qrToken} size={240} />
        ) : null}
      </ActionResultModal>
    </>
  );
}

function parseWholeNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/^0+(?=\d)/, ''));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function hasAnyInventory(payload: Record<GenerationInventoryField, number>) {
  return Object.values(payload).some((value) => value > 0);
}

function isActiveCampaignStatus(status: string | null | undefined) {
  return activeCampaignStatuses.has(String(status ?? ''));
}

function GenerationQuantityField({
  label,
  unit,
  icon,
  value,
  onBlur,
  onChange,
}: {
  label: string;
  unit: string;
  icon?: string;
  value: string;
  onBlur: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className={styles.inventoryItem}>
      {icon ? (
        <span className={styles.inventoryIcon}>
          <img src={icon} alt="" />
        </span>
      ) : null}
      <div>
        <strong>{label}</strong>
        <span>Unit: {unit}</span>
      </div>
      <div className={styles.quantityControl}>
        <label>
          <span className="srOnly">{label}</span>
          <input
            min={0}
            type="number"
            value={value}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
          />
          <small>{unit}</small>
        </label>
      </div>
    </div>
  );
}

function StrategyCard({
  plan,
  isSelected,
  onSelect,
}: {
  plan: ReliefAllocationPlan;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const copy = planCopy[plan.plan_id];
  const totals = planTotals(plan);
  const solverStatuses = Object.values(plan.solver_status ?? {});
  const optimizationStatus =
    solverStatuses.length > 0
      ? Array.from(new Set(solverStatuses)).join(', ')
      : 'Available';

  return (
    <article
      className={`${styles.strategyCard} ${isSelected ? styles.strategyCardSelected : ''}`}
    >
      <div>
        <span>{copy.focus}</span>
        <h4>{plan.plan_name}</h4>
        <p>{copy.description}</p>
      </div>
      <dl className={styles.strategyMeta}>
        <div>
          <dt>Objective Value</dt>
          <dd>{formatNumber(plan.objective_value)}</dd>
        </div>
        <div>
          <dt>Barangays</dt>
          <dd>{plan.allocations.length}</dd>
        </div>
        <div>
          <dt>Total Allocated</dt>
          <dd>{totals.total}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{optimizationStatus}</dd>
        </div>
      </dl>
      <button type="button" onClick={onSelect}>
        {copy.button}
      </button>
    </article>
  );
}

function MetricList({
  title,
  values,
  formatter = formatMetricNumber,
}: {
  title: string;
  values: Record<string, number>;
  formatter?: (value: number | null | undefined) => string;
}) {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;

  return (
    <div className={styles.metricBlock}>
      <strong>{title}</strong>
      <dl>
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{formatMetricLabel(key)}</dt>
            <dd>{formatter(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function AhpBreakdownTable({ breakdown }: { breakdown: AhpBreakdown }) {
  const dimensions = [
    'infant',
    'elderly',
    'pwd',
    'pregnant',
    'lactating',
    'toddler',
    'four_ps',
  ];

  return (
    <div className={styles.ahpTableWrap}>
      <table className={styles.ahpTable}>
        <thead>
          <tr>
            <th>Factor</th>
            <th>Count</th>
            <th>Weight</th>
            <th>Contribution</th>
          </tr>
        </thead>
        <tbody>
          {dimensions.map((dimension) => (
            <tr key={dimension}>
              <td>{formatMetricLabel(dimension)}</td>
              <td>{formatMetricNumber(breakdown.counts?.[dimension])}</td>
              <td>{formatMetricNumber(breakdown.weights?.[dimension])}</td>
              <td>
                {formatMetricNumber(breakdown.contributions?.[dimension])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function latestUniqueRecommendations(rows: Record<string, unknown>[]) {
  const latestByBarangay = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const key = recommendationBarangayKey(row);
    if (!key || latestByBarangay.has(key)) continue;
    latestByBarangay.set(key, row);
  }

  return Array.from(latestByBarangay.values());
}

function normalizePlans(value: unknown): ReliefAllocationPlan[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isReliefPlan);
}

function isReliefPlan(value: unknown): value is ReliefAllocationPlan {
  const plan = asRecord(value);
  const planId = String(plan?.plan_id ?? '');
  return Boolean(
    plan &&
    ['severity_first', 'vulnerability_first', 'balanced'].includes(planId) &&
    typeof plan.plan_name === 'string' &&
    Array.isArray(plan.allocations)
  );
}

function planTotals(plan: ReliefAllocationPlan) {
  const food = plan.allocations.reduce(
    (total, allocation) =>
      total + Number(allocation.recommended_family_food_packs ?? 0),
    0
  );
  const goods = plan.allocations.reduce(
    (total, allocation) =>
      total +
      Number(
        allocation.recommended_individual_relief_goods ??
          allocation.recommended_relief_goods_individual ??
          0
      ),
    0
  );
  const kits = plan.allocations.reduce(
    (total, allocation) =>
      total +
      Number(
        allocation.recommended_emergency_kits ??
          allocation.recommended_medicine_kits ??
          0
      ),
    0
  );
  return { food, goods, kits, total: food + goods + kits };
}

function recommendationBarangayKey(row: Record<string, unknown>) {
  const barangayId =
    row.barangay_id == null ? '' : String(row.barangay_id).trim();
  if (['1', '2', '3'].includes(barangayId)) return barangayId;

  const barangayName = normalizeBarangayForCompare(
    String(row.barangay_name ?? row.barangay ?? '')
  );
  if (barangayName === 'barangay tanong') return '1';
  if (barangayName === 'barangay catmon') return '2';
  if (barangayName === 'barangay potrero') return '3';
  return '';
}

function mapRecommendation(
  row: Record<string, unknown>,
  index: number,
  plan?: ReliefAllocationPlan
): ReliefRecommendation {
  const foodPacks = Number(row.recommended_family_food_packs ?? 0);
  const medicineKits = Number(
    row.recommended_emergency_kits ?? row.recommended_medicine_kits ?? 0
  );
  const individualGoods = Number(
    row.recommended_individual_relief_goods ??
      row.recommended_relief_goods_individual ??
      0
  );
  const analysisReason = formatAnalysisReason(
    String(row.analysis_reason ?? fallbackAnalysisReason(row))
  );
  const affectedFamilies = Number(
    row.affected_families ?? affectedFamiliesFromReason(analysisReason)
  );
  const rawRisk = String(row.risk_level ?? '');
  const riskLevel = formatRiskLevel(rawRisk || riskFromReason(analysisReason));
  const hasSensorReading =
    rawRisk !== 'no_reading' &&
    !/^No latest sensor reading/i.test(analysisReason);
  const hasAllocation = foodPacks + medicineKits + individualGoods > 0;
  const fuzzyExplanation = asRecord(row.fuzzy_explanation);
  const ahpBreakdown = asRecord(row.ahp_breakdown);
  const demandCeiling = numberRecord(asRecord(row.demand_ceiling));

  return {
    recommendation_id: row.recommendation_id
      ? String(row.recommendation_id)
      : undefined,
    id: String(index + 1),
    selectedPlanId: plan?.plan_id,
    selectedPlanName: plan?.plan_name,
    objectiveValue: nullableNumber(plan?.objective_value),
    priorityScore: nullableNumber(row.priority_score),
    waterLevelM: nullableNumber(row.water_level_m),
    barangay_name: String(row.barangay_name ?? row.barangay ?? 'Unknown'),
    barangay: String(row.barangay_name ?? row.barangay ?? 'Unknown'),
    riskLevel,
    affectedFamilies,
    familyFoodPacks: foodPacks,
    medicineKits,
    reliefForIndividual: individualGoods,
    hasSensorReading,
    recommendedItems: hasAllocation
      ? `${foodPacks} food packs, ${medicineKits} medicine kits, ${individualGoods} individual goods`
      : 'Inventory fully allocated to higher-priority areas.',
    analysisReason,
    report: analysisReason,
    fuzzyExplanation: fuzzyExplanation
      ? {
          waterLevelM: nullableNumber(fuzzyExplanation.water_level_m),
          confidence: nullableNumber(fuzzyExplanation.confidence),
          riskLabel: formatRiskLevel(
            String(
              fuzzyExplanation.risk_label ??
                fuzzyExplanation.risk_level ??
                riskLevel
            )
          ),
          memberships:
            numberRecord(asRecord(fuzzyExplanation.memberships)) ?? undefined,
        }
      : undefined,
    ahpBreakdown: ahpBreakdown
      ? {
          counts: numberRecord(asRecord(ahpBreakdown.counts)) ?? undefined,
          weights: numberRecord(asRecord(ahpBreakdown.weights)) ?? undefined,
          contributions:
            numberRecord(asRecord(ahpBreakdown.contributions)) ?? undefined,
          total_vulnerability_score:
            nullableNumber(ahpBreakdown.total_vulnerability_score) ?? undefined,
        }
      : undefined,
    ahpVulnerabilityScore: nullableNumber(
      ahpBreakdown?.total_vulnerability_score
    ),
    demandCeiling: demandCeiling ?? undefined,
    constraintsSatisfied:
      typeof row.constraints_satisfied === 'boolean'
        ? row.constraints_satisfied
        : undefined,
    availableSupply: plan?.available_supply,
    reasoningSteps: Array.isArray(row.reasoning_steps)
      ? row.reasoning_steps.map(String).filter(Boolean)
      : [],
  };
}

function mapEmergencyAllocationItem(
  item: EmergencyAllocationItem,
  index: number
): ReliefRecommendation {
  const familyFoodPacks = Number(item.family_food_packs ?? 0);
  const individualGoods = Number(item.individual_relief_goods ?? 0);
  const emergencyKits = Number(item.emergency_kits ?? 0);
  const hasAllocation = familyFoodPacks + individualGoods + emergencyKits > 0;

  return {
    recommendation_id: item.recommendation_id
      ? String(item.recommendation_id)
      : item.item_id,
    id: String(index + 1),
    barangay_name: item.barangay_name,
    barangay: item.barangay_name,
    riskLevel: 'Restored workflow',
    affectedFamilies: 0,
    familyFoodPacks,
    medicineKits: emergencyKits,
    reliefForIndividual: individualGoods,
    hasSensorReading: false,
    recommendedItems: hasAllocation
      ? `${familyFoodPacks} food packs, ${emergencyKits} emergency kits, ${individualGoods} individual goods`
      : 'No relief items allocated for this barangay.',
    analysisReason: `Persisted emergency allocation restored from batch workflow. Barangay status is ${formatWorkflowStatus(item.barangay_status)}.`,
    report: `Persisted emergency allocation restored from batch workflow. Barangay status is ${formatWorkflowStatus(item.barangay_status)}.`,
    reasoningSteps: [
      'This allocation was loaded from the accepted emergency workflow in Supabase.',
      'No AI generation was triggered during page load.',
      'Barangay notifications are reserved for the next phase.',
    ],
  };
}

function affectedFamiliesFromReason(reason: string) {
  const match = reason.match(/(\d+)\s+affected/i);
  return match ? Number(match[1]) : 0;
}

function riskFromReason(reason: string) {
  const match = reason.match(
    /^(Normal|Flood Alert|Flood Warning|Critical|Warning|Severe|severity)/i
  );
  return match?.[1] ?? 'No reading';
}

function formatRiskLevel(value: string) {
  const normalized = value.replace(/_/g, ' ').trim().toLowerCase();
  if (
    /^(critical|severe|severity|warning|alert|no reading|normal)$/.test(
      normalized
    )
  )
    return getFloodStatusLabel(normalized);
  return normalized ? capitalize(normalized) : 'No reading';
}

function formatWorkflowStatus(value: string) {
  const normalized = value.replace(/_/g, ' ').trim().toLowerCase();
  return normalized
    ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Unknown';
}

function ReportDetail({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableNumber(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberRecord(value: Record<string, unknown> | null) {
  if (!value) return null;
  const entries = Object.entries(value)
    .map(([key, raw]) => [key, nullableNumber(raw)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null);
  return Object.fromEntries(entries);
}

function formatWaterLevel(value: number | null | undefined) {
  return value == null ? 'Unavailable' : `${value.toFixed(2)}m`;
}

function formatConfidence(value: number | null | undefined) {
  return value == null ? 'Unavailable' : `${Math.round(value * 100)}%`;
}

function formatNumber(value: number | null | undefined) {
  return value == null
    ? 'Unavailable'
    : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatMetricNumber(value: number | null | undefined) {
  return value == null
    ? 'Unavailable'
    : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatMetricLabel(value: string) {
  return value
    .replace(/^recommended_/, '')
    .replace(/_/g, ' ')
    .replace(/\bfour ps\b/i, '4Ps')
    .replace(/\bpwd\b/i, 'PWD')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function areAllocationsInteger(recommendation: ReliefRecommendation) {
  return [
    recommendation.familyFoodPacks,
    recommendation.medicineKits,
    recommendation.reliefForIndividual,
  ].every(Number.isInteger);
}

function areAllocationsNonNegative(recommendation: ReliefRecommendation) {
  return [
    recommendation.familyFoodPacks,
    recommendation.medicineKits,
    recommendation.reliefForIndividual,
  ].every((value) => value >= 0);
}

function fallbackAnalysisReason(row: Record<string, unknown>) {
  const riskLevel = String(row.risk_level ?? 'normal').replace(/_/g, ' ');
  return `${riskLevel} flood risk.`;
}

function formatAnalysisReason(reason: string) {
  const withoutScore = reason
    .replace(/\s*,?\s*priority[_\s-]*score\s*:?\s*\d+(\.\d+)?/gi, '')
    .replace(/\s*,?\s*priority[_\s-]*score\s*:?\s*n\/a/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const normalized = withoutScore
    .replace(/\b1 affected families\b/gi, '1 affected family')
    .replace(
      /\b(\d+) affected family record(s)?\b/gi,
      (_match, count: string) =>
        `${count} affected ${count === '1' ? 'family record' : 'family records'}`
    );

  const sensorMatch = normalized.match(
    /^(critical|severity|warning|normal|flood warning)\s+flood risk (?:detected )?at ([^,.]+)(?: with|,)\s*(\d+)\s+affected famil(?:y|ies)\.?(.*)$/i
  );
  if (sensorMatch) {
    const [, risk, level, familyCount, suffix] = sensorMatch;
    return `${formatRiskLevel(risk)} flood risk detected at ${level.trim()} with ${familyCount} affected ${familyCount === '1' ? 'family' : 'families'}.${suffix ? ` ${ensureSentence(capitalize(suffix.trim()))}` : ''}`;
  }

  const noReadingMatch = normalized.match(
    /^no latest sensor reading available\.?\s*(?:based on)?\s*(\d+)\s+affected famil(?:y|ies|y record|y records)\.?(.*)$/i
  );
  if (noReadingMatch) {
    const familyCount = noReadingMatch[1];
    const suffix = noReadingMatch[2]?.trim();
    return `No latest sensor reading available. Based on ${familyCount} affected ${familyCount === '1' ? 'family record' : 'family records'}.${suffix ? ` ${ensureSentence(capitalize(suffix))}` : ''}`;
  }

  if (!normalized)
    return 'Recommendation generated from current flood and resident data.';
  return ensureSentence(
    capitalize(normalized.replace(/\bcritical\b/gi, 'Severe'))
  );
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function ensureSentence(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function mapHistory(row: Record<string, unknown>, index: number) {
  const createdAt = row.created_at
    ? new Date(String(row.created_at))
    : new Date(Number.NaN);
  const recommendationId = String(row.recommendation_id ?? '');

  return {
    recommendation_id: recommendationId,
    id: recommendationId ? shortenId(recommendationId) : 'Not recorded',
    createdAt,
    barangay_name: String(row.barangay_name ?? row.barangay ?? 'Unknown'),
    date: Number.isNaN(createdAt.getTime())
      ? 'Not recorded'
      : createdAt.toLocaleDateString(),
    time: Number.isNaN(createdAt.getTime())
      ? 'Not recorded'
      : createdAt.toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
    barangay: String(row.barangay_name ?? row.barangay ?? 'Unknown'),
    familyFoodPacks: Number(row.recommended_family_food_packs ?? 0),
    medicineKits: Number(row.recommended_medicine_kits ?? 0),
    reliefForIndividual: Number(row.recommended_relief_goods_individual ?? 0),
  };
}

function shortenId(id: string) {
  return id.length > 12 ? id.slice(0, 8) : id;
}

function defaultHistoryDateFilter(
  history: HistoryEntry[]
): Exclude<HistoryDateFilter, ''> {
  return history.some((entry) => isInDateFilter(entry.createdAt, 'today'))
    ? 'today'
    : 'all';
}

function isInDateFilter(date: Date, filter: Exclude<HistoryDateFilter, ''>) {
  if (filter === 'all') return true;
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfEntry = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  if (filter === 'today') {
    return startOfEntry.getTime() === startOfToday.getTime();
  }

  if (filter === 'last7') {
    const sevenDaysAgo = new Date(startOfToday);
    sevenDaysAgo.setDate(startOfToday.getDate() - 6);
    return startOfEntry >= sevenDaysAgo && startOfEntry <= startOfToday;
  }

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

function sortHistoryEntries(
  a: HistoryEntry,
  b: HistoryEntry,
  sort: HistorySort
) {
  if (sort === 'oldest') return a.createdAt.getTime() - b.createdAt.getTime();
  if (sort === 'barangay')
    return formatBarangayName(a.barangay).localeCompare(
      formatBarangayName(b.barangay)
    );
  if (sort === 'food') return b.familyFoodPacks - a.familyFoodPacks;
  if (sort === 'medicine') return b.medicineKits - a.medicineKits;
  if (sort === 'goods') return b.reliefForIndividual - a.reliefForIndividual;
  return b.createdAt.getTime() - a.createdAt.getTime();
}
