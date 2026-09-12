export type PageKey =
  | "dashboard"
  | "logs"
  | "systemLogs"
  | "monitoring"
  | "relief"
  | "reliefManagement"
  | "emergencyNotifications"
  | "reliefDistribution"
  | "sensors"
  | "residents"
  | "accounts";

export type DashboardRole = "super" | "barangay" | "cswdd" | "cdrrmo";

export interface NavItem {
  key: PageKey;
  label: string;
  icon: "home" | "monitor" | "folder" | "document" | "droplet" | "cube" | "signal" | "users" | "check";
}

export interface BarangayOption {
  barangay_id: number;
  barangay_name: string;
}

export interface PageCopy {
  title: string;
  subtitle: string;
}
