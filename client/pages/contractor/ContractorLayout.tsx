import { useEffect } from "react";
import { LayoutDashboard, FolderKanban, Camera, Wallet, CalendarClock } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";
import ContractorMembership from "@/components/contractor/ContractorMembership";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchContractorBilling } from "@/store/slices/contractorBillingSlice";
import BillingNotice from "@/components/billing/BillingNotice";

export default function ContractorLayout() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.portalAuth.contractor.user);
  const { locked, portal: billing } = useAppSelector((s) => s.contractorBilling);
  useEffect(() => {
    if (user) void dispatch(fetchContractorBilling());
  }, [dispatch, user]);
  return (
    <PortalShell
      tabs={["/contractor", "/contractor/projects", "/contractor/photos", "/contractor/draws"]}
      actor="contractor"
      loginPath="/contractor/login"
      titleKey="portalNav.contractorTitle"
      // Membership not in good standing → every page shows the billing step until it is.
      gate={user && locked ? <ContractorMembership mode="gate" /> : undefined}
      notice={<BillingNotice billing={billing} to="/contractor" />}
      nav={[
        {
          to: "/contractor",
          end: true,
          labelKey: "portalNav.dashboard",
          icon: LayoutDashboard,
        },
        {
          to: "/contractor/projects",
          labelKey: "portalNav.projects",
          icon: FolderKanban,
        },
        { to: "/contractor/appointments", labelKey: "portalNav.appointments", icon: CalendarClock },
        { to: "/contractor/photos", labelKey: "portalNav.photos", icon: Camera },
        { to: "/contractor/draws", labelKey: "portalNav.draws", icon: Wallet },
      ]}
    />
  );
}
