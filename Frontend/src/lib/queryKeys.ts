export const queryStaleTime = {
  realTime: 5_000,
  operational: 30_000,
  admin: 2 * 60_000,
  logs: 5 * 60_000,
  reference: 10 * 60_000,
} as const;

export const queryKeys = {
  sensors: {
    latest: ["sensors", "latest"] as const,
    history: (limit: number) => ["sensors", "history", limit] as const,
    floodMonitoring: (historyLimit: number) => ["flood-monitoring", historyLimit] as const,
  },
  relief: {
    recommendations: ["relief", "recommendations"] as const,
    currentAllocation: ["relief", "current-allocation"] as const,
    campaigns: ["relief", "campaigns"] as const,
    distributionHistory: (batchId?: string | null, page?: number, limit?: number) => ["relief", "distribution-history", batchId ?? "all", page ?? "all", limit ?? "all"] as const,
    distributionReport: (batchId: string) => ["relief", "distribution-report", batchId] as const,
    notReceived: (batchId: string, page: number, limit: number) => ["relief", "not-received", batchId, page, limit] as const,
    beneficiaryStatus: (batchId: string, filter: string, search: string, page: number, limit: number) => ["relief", "beneficiary-status", batchId, filter, search, page, limit] as const,
  },
  notifications: {
    emergency: ["emergency", "notifications"] as const,
  },
  residents: {
    list: (barangayId?: number) => ["residents", barangayId ?? "all"] as const,
    families: (search = "", barangayId?: number) => ["families", search, barangayId ?? "all"] as const,
  },
  verification: {
    applications: (barangayId?: number) => ["verification", "applications", barangayId ?? "all"] as const,
  },
  accounts: {
    users: ["accounts", "users"] as const,
  },
  logs: {
    audit: ["logs", "audit"] as const,
  },
} as const;
