import { Banknote, FileSignature, LayoutDashboard, MapPinned, UserCog, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import PortalShell, { type PortalNavItem } from "@/components/portal/PortalShell";
import { ViewAsBanner } from "@/components/partnerKit/PartnerKit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { logoutPortal } from "@/store/slices/portalAuthSlice";

const NAV: PortalNavItem[] = [
  { to: "/city", end: true, labelKey: "portalNav.dashboard", icon: LayoutDashboard },
  { to: "/city/cities", labelKey: "cityPartner.navCities", icon: MapPinned },
  { to: "/city/clients", labelKey: "cityPartner.navClients", icon: Users },
  { to: "/city/fees", labelKey: "cityPartner.navFees", icon: Banknote },
  { to: "/city/agreement", labelKey: "cityPartner.navAgreement", icon: FileSignature },
  { to: "/city/profile", labelKey: "cityPartner.navProfile", icon: UserCog },
];

/** City Partner portal (invite-only). A super admin's "View as partner" session shows a read-only banner. */
export default function CityLayout() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.portalAuth.city.user);
  const viewer = user?.view_as_admin;
  return (
    <>
      {viewer ? (
        <ViewAsBanner
          text={t("cityPartner.viewingAs", { name: `${user.first_name} ${user.last_name}`.trim(), admin: viewer.name })}
          exitLabel={t("cityPartner.exitView")}
          onExit={async () => {
            await dispatch(logoutPortal("city"));
            window.close();
            window.location.href = "/admin/city-partners";
          }}
        />
      ) : null}
      <PortalShell actor="city" loginPath="/city/login" titleKey="cityPartner.portalTitle" nav={NAV} tabs={["/city", "/city/cities", "/city/clients", "/city/fees"]} />
    </>
  );
}
