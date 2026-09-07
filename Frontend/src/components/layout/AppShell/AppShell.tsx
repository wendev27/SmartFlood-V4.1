"use client";

import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar/Sidebar";
import { Topbar } from "@/components/layout/Topbar/Topbar";
import { DashboardPresentationContext, type DashboardPresentationNavigation } from "@/components/layout/DashboardPresentationContext";
import type { DashboardRole, NavItem, PageKey } from "@/types/navigation";
import styles from "./AppShell.module.css";

export interface DashboardUserProfile {
  userId: string;
  displayName: string;
  email: string;
  roleLabel: string;
  roleSubtitle: string;
  initials: string;
  logLabel: string;
  barangayId?: number | null;
  barangayName?: string | null;
}

export type AdminViewContext = {
  role: "barangay";
  label: string;
};

interface AppShellProps {
  presentation?: DashboardPresentationNavigation;
  adminView?: AdminViewContext | null;
  userRole?: DashboardRole;
  activePage: PageKey;
  isMobileNavOpen: boolean;
  hideTopbar?: boolean;
  navigationItems?: NavItem[];
  userProfile: DashboardUserProfile;
  onNavigate: (page: PageKey, adminView?: AdminViewContext) => void;
  onToggleMobileNav: () => void;
  children: ReactNode;
}

export function AppShell({
  presentation,
  adminView,
  userRole,
  activePage,
  isMobileNavOpen,
  hideTopbar = false,
  navigationItems,
  userProfile,
  onNavigate,
  onToggleMobileNav,
  children,
}: AppShellProps) {
  return (
    <DashboardPresentationContext.Provider value={presentation ?? null}>
    <main className={styles.shell}>
      <Sidebar
        activePage={activePage}
        isOpen={isMobileNavOpen}
        items={navigationItems}
        userProfile={userProfile}
        userRole={userRole}
        adminView={adminView}
        onNavigate={onNavigate}
        onToggleMobileNav={onToggleMobileNav}
      />
      <section className={styles.dashboard}>
        {hideTopbar && !presentation?.view ? null : <Topbar activePage={activePage} userProfile={userProfile} userRole={userRole} actionsOnly={Boolean(presentation?.view)} />}
        <div className={styles.content}>{children}</div>
      </section>
    </main>
    </DashboardPresentationContext.Provider>
  );
}
