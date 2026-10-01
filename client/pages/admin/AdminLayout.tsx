import {
  LayoutDashboard,
  Inbox,
  Users,
  Handshake,
  HardHat,
  FolderKanban,
  Wallet,
  Coins,
  ShieldCheck,
  Home,
  Settings,
  CalendarDays,
} from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";

export default function AdminLayout() {
  return (
    <PortalShell
      actor="admin"
      loginPath="/admin/login"
      titleKey="portalNav.adminTitle"
      nav={[
        { to: "/admin", end: true, labelKey: "portalNav.dashboard", icon: LayoutDashboard },
        { to: "/admin/leads", labelKey: "portalNav.leads", icon: Inbox, perm: "leads" },
        // Visible to content (events) and agents (leads, read-only); writes gate inside the pages.
        { to: "/admin/events", labelKey: "portalNav.events", icon: CalendarDays, perm: ["events", "leads"] },
        { to: "/admin/projects", labelKey: "portalNav.projects", icon: FolderKanban, perm: "projects.read" },
        { to: "/admin/clients", labelKey: "portalNav.clients", icon: Users, perm: "people.read" },
        { to: "/admin/affiliates", labelKey: "portalNav.affiliates", icon: Handshake, perm: "people.read" },
        { to: "/admin/contractors", labelKey: "portalNav.contractors", icon: HardHat, perm: "people.read" },
        { to: "/admin/draws", labelKey: "portalNav.draws", icon: Wallet, perm: "projects.read" },
        { to: "/admin/commissions", labelKey: "portalNav.commissions", icon: Coins, perm: "finance.read" },
        { to: "/admin/plans", labelKey: "portalNav.plans", icon: Home },
        { to: "/admin/staff", labelKey: "portalNav.staff", icon: ShieldCheck, perm: "staff" },
        { to: "/admin/settings", labelKey: "portalNav.settings", icon: Settings, perm: "settings" },
      ]}
    />
  );
}
