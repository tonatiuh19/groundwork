import { useEffect, useMemo } from "react";
import {
  LayoutDashboard,
  Users,
  Banknote,
  Link2,
  UserCog,
  Network,
} from "lucide-react";
import type { PortalNavItem } from "@/components/portal/PortalShell";
import PortalShell from "@/components/portal/PortalShell";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAffiliateOverview } from "@/store/slices/affiliatePortalSlice";

export default function AffiliateLayout() {
  const dispatch = useAppDispatch();
  const overview = useAppSelector((s) => s.affiliatePortal.overview);

  useEffect(() => {
    if (!overview) void dispatch(fetchAffiliateOverview());
  }, [dispatch, overview]);

  // Only show after overview confirms top-level (avoid flashing for subs).
  const canManageTeam = overview?.affiliate.can_manage_team === true;

  const nav = useMemo((): PortalNavItem[] => {
    const items: PortalNavItem[] = [
      {
        to: "/affiliate",
        end: true,
        labelKey: "portalNav.dashboard",
        icon: LayoutDashboard,
      },
      { to: "/affiliate/clients", labelKey: "portalNav.myClients", icon: Users },
    ];
    if (canManageTeam) {
      items.push({
        to: "/affiliate/team",
        labelKey: "portalNav.myTeam",
        icon: Network,
      });
    }
    items.push(
      {
        to: "/affiliate/commissions",
        labelKey: "portalNav.commissions",
        icon: Banknote,
      },
      { to: "/affiliate/link", labelKey: "portalNav.trackingLink", icon: Link2 },
      { to: "/affiliate/profile", labelKey: "portalNav.profile", icon: UserCog },
    );
    return items;
  }, [canManageTeam]);

  return (
    <PortalShell
      actor="affiliate"
      loginPath="/affiliate/login"
      titleKey="portalNav.affiliateTitle"
      nav={nav}
    />
  );
}
