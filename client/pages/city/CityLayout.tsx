import { Banknote, FileSignature, LayoutDashboard, MapPinned, UserCog, Users } from "lucide-react";
import PortalShell, { type PortalNavItem } from "@/components/portal/PortalShell";

const NAV: PortalNavItem[] = [
  { to: "/city", end: true, labelKey: "portalNav.dashboard", icon: LayoutDashboard },
  { to: "/city/cities", labelKey: "cityPartner.navCities", icon: MapPinned },
  { to: "/city/clients", labelKey: "cityPartner.navClients", icon: Users },
  { to: "/city/fees", labelKey: "cityPartner.navFees", icon: Banknote },
  { to: "/city/agreement", labelKey: "cityPartner.navAgreement", icon: FileSignature },
  { to: "/city/profile", labelKey: "cityPartner.navProfile", icon: UserCog },
];

/** City Partner portal (invite-only). */
export default function CityLayout() {
  return <PortalShell actor="city" loginPath="/city/login" titleKey="cityPartner.portalTitle" nav={NAV} tabs={["/city", "/city/cities", "/city/clients", "/city/fees"]} />;
}
