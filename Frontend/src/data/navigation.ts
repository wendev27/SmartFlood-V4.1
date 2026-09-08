import type { DashboardRole, NavItem } from '@/types/navigation';

export const navigationItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'home' },
  { key: 'monitoring', label: 'Flood Monitoring Module', icon: 'droplet' },
  { key: 'relief', label: 'AI-Optimized Relief Recommendation', icon: 'cube' },
  {
    key: 'reliefManagement',
    label: 'Emergency Relief Management',
    icon: 'document',
  },
  { key: 'reliefDistribution', label: 'Relief Audit Reports', icon: 'check' },
  { key: 'residents', label: 'Resident Information', icon: 'users' },
  {
    key: 'accounts',
    label: 'Resident Account Registration Management',
    icon: 'check',
  },
  { key: 'logs', label: 'Account Management', icon: 'folder' },
  { key: 'systemLogs', label: 'System Logs', icon: 'document' },
];

export function navigationItemsForRole(role: DashboardRole): NavItem[] {
  if (role === 'super') return navigationItems;

  const logsLabel =
    role === 'barangay'
      ? 'Barangay Logs'
      : role === 'cswdd'
        ? 'CSWDD Logs'
        : 'CDRRMO Logs';

  if (role === 'cswdd') {
    return [
      { key: 'dashboard', label: 'Dashboard', icon: 'home' },
      { key: 'monitoring', label: 'Flood Monitoring Module', icon: 'droplet' },
      {
        key: 'relief',
        label: 'AI-Optimized Relief Recommendation',
        icon: 'cube',
      },
      { key: 'residents', label: 'Resident Information', icon: 'users' },
      { key: 'systemLogs', label: logsLabel, icon: 'document' },
    ];
  }

  if (role === 'cdrrmo') {
    return [
      { key: 'dashboard', label: 'Dashboard', icon: 'home' },
      { key: 'monitoring', label: 'Flood Monitoring Module', icon: 'droplet' },
      { key: 'systemLogs', label: logsLabel, icon: 'document' },
    ];
  }

  return [
    { key: 'dashboard', label: 'Dashboard', icon: 'home' },
    { key: 'monitoring', label: 'Flood Monitoring Module', icon: 'droplet' },
    {
      key: 'emergencyNotifications',
      label: 'Emergency Notifications',
      icon: 'document',
    },
    { key: 'reliefDistribution', label: 'Relief Distribution', icon: 'check' },
    { key: 'residents', label: 'Resident Information', icon: 'users' },
    {
      key: 'accounts',
      label: 'Resident Account Registration Management',
      icon: 'check',
    },
    { key: 'systemLogs', label: logsLabel, icon: 'document' },
  ];
}
