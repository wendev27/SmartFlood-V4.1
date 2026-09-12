"use client";

import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { navigationItems } from "@/data/navigation";
import { cn } from "@/lib/cn";
import type { DashboardRole, NavItem, PageKey } from "@/types/navigation";
import { NavActionItem, NavLinkItem, SidebarIcon } from "@/components/navigation/NavLinkItem/NavLinkItem";
import { useDashboardPresentation } from "@/components/layout/DashboardPresentationContext";
import { profileSealForRole } from "@/adapters/profilePresentation";
import type { AdminViewContext, DashboardUserProfile } from "@/components/layout/AppShell/AppShell";
import { navigationPresentation } from "@/adapters/navigationPresentation";
import { clearStoredSession } from "@/lib/authSession";
import { getBarangays } from "@/services/logsService";
import { queryKeys, queryStaleTime } from "@/lib/queryKeys";
import styles from "./Sidebar.module.css";

function sealForGroup(label: string): string | null {
  const key = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (key === "cswdd") return "/images/cswdd/cswdd-seal.png";
  if (key.includes("longos")) return "/images/dashboard/barangay-longos-seal.png";
  if (key.includes("tanong")) return "/images/dashboard/barangay-tanong-seal.jpg";
  if (key.includes("potrero")) return "/images/dashboard/barangay-potrero-seal.png";
  return null;
}

interface SidebarProps {
  userRole?: DashboardRole;
  adminView?: AdminViewContext | null;
  activePage: PageKey;
  isOpen: boolean;
  items?: NavItem[];
  userProfile: DashboardUserProfile;
  onNavigate: (page: PageKey, adminView?: AdminViewContext) => void;
  onToggleMobileNav: () => void;
}

export function Sidebar({ activePage, adminView, isOpen, items = navigationItems, userProfile, userRole, onNavigate, onToggleMobileNav }: SidebarProps) {
  const barangaysQuery = useQuery({
    queryKey: queryKeys.accounts.barangays,
    queryFn: getBarangays,
    staleTime: queryStaleTime.reference,
    enabled: userRole === "super" || userRole === "cdrrmo",
  });
  const { primary, groups } = navigationPresentation(items, userRole, userProfile.logLabel, barangaysQuery.data ?? []);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const presentation = useDashboardPresentation();
  const profileSeal = profileSealForRole(userRole, userProfile.barangayName, userProfile.barangayId);
  const visibleRoleLabel = userRole === "super" ? "CDRRMO Command Center" : userProfile.roleLabel;
  const reportItem: NavItem = { key: "reliefDistribution", label: "Emergency Report Management", icon: "document" };

  function logout() {
    fetch("/api/auth/logout", { method: "POST", keepalive: true }).catch(() => undefined);
    clearStoredSession();
    window.location.href = "/";
  }

  return (
    <aside className={styles.sidebar} aria-label="Main navigation">
      <nav className={cn(styles.navCard, isOpen && styles.open)}>
        <button
          className={styles.mobileToggle}
          type="button"
          aria-expanded={isOpen}
          aria-controls="smartflood-nav-links"
          onClick={onToggleMobileNav}
        >
          <span />
          Menu
        </button>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          <h1>SmartFlood</h1>
        </div>
        <div className={styles.navLinks} id="smartflood-nav-links">
          {primary.map((item) => (
            <Fragment key={item.key}>
            <NavLinkItem
              item={item}
              isActive={!presentation?.view && item.key === activePage}
              onNavigate={onNavigate}
            />
            {userRole === "barangay" && item.key === "emergencyNotifications" && presentation ? <NavActionItem item={reportItem} isActive={presentation.view === "emergencyReports"} onClick={() => presentation.open("emergencyReports")} /> : null}
            </Fragment>
          ))}
          {groups.length > 0 ? <div className={styles.accessGroups}>
            {groups.map((group) => {
              const groupSeal = sealForGroup(group.label);
              const groupIsActive = group.label === "CSWDD"
                ? !adminView
                : adminView?.label === group.label;
              return (
                <details className={styles.accessGroup} key={group.label} open={adminView?.label === group.label || undefined}>
                  <summary>
                    {groupSeal ? <img src={groupSeal} alt="" /> : <span className={styles.groupIcon} aria-hidden="true"><SidebarIcon item={{ key: group.items[0].key, label: group.label, icon: group.icon }} /></span>}
                    <span>{group.label}</span>
                    <svg className={styles.chevron} viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
                  </summary>
                  <div className={styles.accessItems}>
                    {group.items.map((item) => <NavActionItem key={item.key} item={item} isActive={groupIsActive && ((item.key === "reliefDistribution" && presentation?.view === "emergencyReports") || (!presentation?.view && item.key === activePage))} onClick={() => { const context = group.label.startsWith("Barangay ") ? { role: "barangay" as const, label: group.label } : undefined; if (item.key === "reliefDistribution" && presentation && context) { onNavigate("emergencyNotifications", context); presentation.open("emergencyReports"); } else onNavigate(item.key, context); }} />)}
                  </div>
                </details>
              );
            })}
          </div> : null}
        </div>
        <div className={styles.profileCard} onMouseLeave={() => setIsProfileOpen(false)}>
          <button className={styles.profileSummary} type="button" aria-label="View profile" aria-expanded={isProfileOpen} aria-controls="sidebar-profile-details" onMouseEnter={() => setIsProfileOpen(true)} onClick={() => setIsProfileOpen((open) => !open)} onKeyDown={(event) => { if (event.key === "Escape") setIsProfileOpen(false); }}>
            {profileSeal ? <img className={styles.profileSeal} src={profileSeal} alt="" /> : <span className={styles.profileAvatar}>{userProfile.initials}</span>}
            <span className={styles.profileName}>
              <strong title={userProfile.displayName}>{userProfile.displayName}</strong>
              <small title={visibleRoleLabel}>{visibleRoleLabel}</small>
            </span>
          </button>
          <button type="button" onClick={logout} aria-label="Log out">
            <svg className={styles.logoutIcon} xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M13.9698 20.4147H13.8506C9.78063 20.4147 7.81899 18.8105 7.47982 15.2172C7.44315 14.8413 7.71815 14.5022 8.10315 14.4655C8.47899 14.4288 8.81815 14.713 8.85482 15.0888C9.12065 17.9672 10.4773 19.0397 13.8598 19.0397H13.979C17.7098 19.0397 19.0298 17.7197 19.0298 13.9888V8.01214C19.0298 4.2813 17.7098 2.9613 13.979 2.9613H13.8598C10.459 2.9613 9.10232 4.05214 8.85482 6.98547C8.80899 7.3613 8.49732 7.64547 8.10315 7.6088C7.71815 7.5813 7.44314 7.24214 7.47064 6.8663C7.78231 3.21797 9.75313 1.5863 13.8506 1.5863H13.9698C18.4706 1.5863 20.3956 3.5113 20.3956 8.01214V13.9888C20.3956 18.4897 18.4706 20.4147 13.9698 20.4147Z" fill="#0088FF" />
              <path d="M13.6402 11.6875H1.8335C1.45766 11.6875 1.146 11.3758 1.146 11C1.146 10.6242 1.45766 10.3125 1.8335 10.3125H13.6402C14.016 10.3125 14.3277 10.6242 14.3277 11C14.3277 11.3758 14.0252 11.6875 13.6402 11.6875Z" fill="#0088FF" />
              <path d="M11.5959 14.7581C11.4217 14.7581 11.2475 14.6939 11.11 14.5564C10.8442 14.2906 10.8442 13.8506 11.11 13.5848L13.695 10.9998L11.11 8.41482C10.8442 8.14898 10.8442 7.70898 11.11 7.44315C11.3759 7.17732 11.8159 7.17732 12.0817 7.44315L15.1525 10.5139C15.4184 10.7798 15.4184 11.2198 15.1525 11.4856L12.0817 14.5564C11.9442 14.6939 11.77 14.7581 11.5959 14.7581Z" fill="#0088FF" />
            </svg>
          </button>
          {isProfileOpen ? <div className={styles.profileDropdown} id="sidebar-profile-details">
            <strong>{userProfile.displayName}</strong>
            <p>{userProfile.email || "No email available"}</p>
            <dl><div><dt>Role</dt><dd>{visibleRoleLabel}</dd></div><div><dt>Access</dt><dd>{userProfile.logLabel}</dd></div></dl>
            <button className={styles.profileLogout} type="button" onClick={logout}>Logout</button>
          </div> : null}
        </div>
      </nav>
    </aside>
  );
}
