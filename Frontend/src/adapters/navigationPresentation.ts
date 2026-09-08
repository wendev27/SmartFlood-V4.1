import type { DashboardRole, NavItem, PageKey } from "@/types/navigation";

export interface NavigationGroup {
  label: string;
  icon: NavItem["icon"];
  items: NavItem[];
}

/** REY labels and hierarchy over V3.2's already-authorized destinations. */
export function navigationPresentation(items: NavItem[], role?: DashboardRole, logLabel?: string): { primary: NavItem[]; groups: NavigationGroup[] } {
  const presented = items.map((item): NavItem => {
    if (item.key === "dashboard") return { ...item, label: "Home" };
    if (item.key === "relief" || item.key === "emergencyNotifications") return { ...item, label: "Relief Management", icon: "cube" };
    if (item.key === "residents" && role === "barangay") return { ...item, label: "Registry of Barangay Inhabitants (RBI)" };
    if (item.key === "systemLogs" && logLabel) return { ...item, label: logLabel };
    return item;
  });
  // REY uses flat navigation for CSWDD/barangay. Extra V3.2 features stay reachable.
  if (role !== "super") {
    const visible = role === "barangay" ? presented.filter((item) => item.key !== "reliefDistribution") : presented;
    return { primary: visible, groups: [] };
  }

  // A super user's existing routes can be grouped, but these groups never select
  // another identity or imply the reference's unsupported barangay impersonation.
  const reliefKeys: PageKey[] = ["relief", "reliefManagement", "emergencyNotifications", "reliefDistribution"];
  const residentItems = presented.filter((item) => ["residents", "accounts"].includes(item.key));
  const barangayNames = ["Barangay Tanong", "Barangay Catmon", "Barangay Potrero"];
  const barangayGroups = barangayNames.map((label) => ({
    label,
    icon: "users" as const,
    items: [
      { key: "emergencyNotifications" as const, label: "Relief Management", icon: "cube" as const },
      { key: "reliefDistribution" as const, label: "Emergency Report Management", icon: "document" as const },
      ...residentItems,
    ],
  }));
  const groups = ([
    { label: "CSWDD", icon: "cube", items: presented.filter((item) => reliefKeys.includes(item.key) && item.key !== "reliefDistribution") },
    ...barangayGroups,
  ] satisfies NavigationGroup[]).filter((group) => group.items.length > 0);
  return {
    primary: presented.filter((item) => !reliefKeys.includes(item.key) && !["residents", "accounts"].includes(item.key)),
    groups,
  };
}
