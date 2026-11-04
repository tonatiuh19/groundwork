import {
  MapPinned,
  LayoutDashboard,
  CreditCard,
  Inbox,
  Users,
  Handshake,
  HardHat,
  FolderKanban,
  Wallet,
  Workflow,
  Coins,
  ShieldCheck,
  Home,
  Settings,
  CalendarClock,
  CalendarDays,
  MessagesSquare,
  BookUser,
  Megaphone,
  FileText,
  Mail,
  QrCode,
  Trophy,
} from "lucide-react";
import { useEffect } from "react";
import PortalShell from "@/components/portal/PortalShell";
import GlobalVoiceManager from "@/components/GlobalVoiceManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMailStatus } from "@/store/slices/mailSlice";
import { useScorecardEnabled } from "@/hooks/useScorecardEnabled";

export default function AdminLayout() {
  const dispatch = useAppDispatch();
  const adminId = useAppSelector((s) => s.portalAuth.admin.user?.id);
  const scorecards = useScorecardEnabled();
  const mailUnread = useAppSelector((s) => (s.mail.status?.mailboxes ?? []).reduce((n, m) => n + m.unread, 0));
  // Mail unread badge: load once signed in, refresh every 2 minutes.
  useEffect(() => {
    if (!adminId) return;
    void dispatch(fetchMailStatus());
    const id = window.setInterval(() => void dispatch(fetchMailStatus()), 120_000);
    return () => window.clearInterval(id);
  }, [adminId, dispatch]);
  const conversationsEnabled = useAppSelector(
    (s) => !!s.portalAuth.admin.user?.conversations_enabled,
  );

  const shell = (
    <PortalShell
      tabs={["/admin", "/admin/leads", "/admin/projects", "/admin/conversations"]}
      actor="admin"
      loginPath="/admin/login"
      titleKey="portalNav.adminTitle"
      nav={[
        { to: "/admin", end: true, labelKey: "portalNav.dashboard", icon: LayoutDashboard },
        // Grow: new business coming in.
        { to: "/admin/leads", labelKey: "portalNav.leads", icon: Inbox, perm: "leads", section: "portalNav.sectionGrow" },
        // Visible to content (events) and agents (leads, read-only); writes gate inside the pages.
        { to: "/admin/events", labelKey: "portalNav.events", icon: CalendarDays, perm: ["events", "leads"], section: "portalNav.sectionGrow" },
        { to: "/admin/qr-codes", labelKey: "portalNav.qrCodes", icon: QrCode, perm: "events", section: "portalNav.sectionGrow" },
        { to: "/admin/city-pipeline", labelKey: "cityPartner.navPipeline", icon: MapPinned, perm: "approvals", section: "portalNav.sectionGrow" },
        { to: "/admin/city-partners", labelKey: "cityPartner.navPartners", icon: Handshake, perm: ["approvals", "finance.read"], section: "portalNav.sectionGrow" },
        { to: "/admin/campaigns", labelKey: "portalNav.campaigns", icon: Megaphone, perm: "campaigns", section: "portalNav.sectionGrow" },
        { to: "/admin/flows", labelKey: "portalNav.flows", icon: Workflow, perm: "people.read", section: "portalNav.sectionGrow" },
        // Inbox: talking to people.
        { to: "/admin/conversations", labelKey: "portalNav.conversations", icon: MessagesSquare, requiresConversations: true, section: "portalNav.sectionInbox" },
        { to: "/admin/mail", labelKey: "portalNav.mail", icon: Mail, badge: mailUnread, section: "portalNav.sectionInbox" },
        { to: "/admin/templates", labelKey: "portalNav.templates", icon: FileText, requiresConversations: true, section: "portalNav.sectionInbox" },
        { to: "/admin/calendar", labelKey: "portalNav.calendar", icon: CalendarClock, perm: "projects.read", section: "portalNav.sectionInbox" },
        // People: everyone in the CRM.
        { to: "/admin/contacts", labelKey: "portalNav.contacts", icon: BookUser, perm: "people.read", section: "portalNav.sectionPeople" },
        { to: "/admin/clients", labelKey: "portalNav.clients", icon: Users, perm: "people.read", section: "portalNav.sectionPeople" },
        { to: "/admin/affiliates", labelKey: "portalNav.affiliates", icon: Handshake, perm: "people.read", section: "portalNav.sectionPeople" },
        { to: "/admin/contractors", labelKey: "portalNav.contractors", icon: HardHat, perm: "people.read", section: "portalNav.sectionPeople" },
        // Scorecards: SCORECARD_ENABLED + super_admin/admin only (the server sends scorecard_enabled).
        ...(scorecards ? [{ to: "/admin/scorecards", labelKey: "portalNav.scorecards", icon: Trophy, perm: "approvals" as const, section: "portalNav.sectionPeople" }] : []),
        // Projects & money.
        { to: "/admin/projects", labelKey: "portalNav.projects", icon: FolderKanban, perm: "projects.read", section: "portalNav.sectionProjects" },
        { to: "/admin/draws", labelKey: "portalNav.draws", icon: Wallet, perm: "projects.read", section: "portalNav.sectionProjects" },
        { to: "/admin/commissions", labelKey: "portalNav.commissions", icon: Coins, perm: "finance.read", section: "portalNav.sectionProjects" },
        { to: "/admin/billing", labelKey: "portalNav.billing", icon: CreditCard, perm: "people.read", section: "portalNav.sectionProjects" },
        // Setup.
        { to: "/admin/plans", labelKey: "portalNav.plans", icon: Home, section: "portalNav.sectionSetup" },
        { to: "/admin/staff", labelKey: "portalNav.staff", icon: ShieldCheck, perm: "staff", section: "portalNav.sectionSetup" },
        { to: "/admin/settings", labelKey: "portalNav.settings", icon: Settings, perm: "settings", section: "portalNav.sectionSetup" },
      ]}
    />
  );

  // Provider must wrap PortalShell so Conversations (Outlet) can dial.
  return conversationsEnabled ? (
    <GlobalVoiceManager>{shell}</GlobalVoiceManager>
  ) : (
    shell
  );
}
