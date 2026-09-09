import type { PageCopy, PageKey } from "@/types/navigation";

export const pageCopy: Record<PageKey, PageCopy> = {
  dashboard: {
    title: "Welcome back!",
    subtitle: "Manage your barangay operations efficiently and effectively",
  },
  logs: {
    title: "Account Management",
    subtitle: "Manage web dashboard accounts and role-based access.",
  },
  systemLogs: {
    title: "System Logs",
    subtitle: "Manage user accounts and view system audit logs",
  },
  monitoring: {
    title: "Flood Monitoring Module",
    subtitle: "Manage your barangay operations efficiently and effectively",
  },
  relief: {
    title: "AI-Optimized Relief Recommendation",
    subtitle: "",
  },
  reliefManagement: {
    title: "Emergency Relief Management",
    subtitle: "Start, monitor, and close relief operations without losing campaign history.",
  },
  emergencyNotifications: {
    title: "Emergency Notifications",
    subtitle: "Review emergency relief allocations sent to your barangay.",
  },
  reliefDistribution: {
    title: "Relief Distribution",
    subtitle: "Verify eligible families and confirm actual relief receipt.",
  },
  sensors: {
    title: "Sensor History",
    subtitle: "View and monitor sensor device readings",
  },
  residents: {
    title: "Resident Information",
    subtitle: "",
  },
  accounts: {
    title: "Resident Account Registration Management",
    subtitle: "",
  },
};
