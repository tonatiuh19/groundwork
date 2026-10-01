import { LayoutDashboard, Users, Banknote, Link2, UserCog } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";

export default function AffiliateLayout() {
  return (
    <PortalShell
      actor="affiliate"
      loginPath="/affiliate/login"
      titleKey="portalNav.affiliateTitle"
      nav={[
        {
          to: "/affiliate",
          end: true,
          labelKey: "portalNav.dashboard",
          icon: LayoutDashboard,
        },
        { to: "/affiliate/clients", labelKey: "portalNav.myClients", icon: Users },
        {
          to: "/affiliate/commissions",
          labelKey: "portalNav.commissions",
          icon: Banknote,
        },
        { to: "/affiliate/link", labelKey: "portalNav.trackingLink", icon: Link2 },
        { to: "/affiliate/profile", labelKey: "portalNav.profile", icon: UserCog },
      ]}
    />
  );
}
