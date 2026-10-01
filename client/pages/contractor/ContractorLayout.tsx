import { LayoutDashboard, FolderKanban, Camera, Wallet } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";

export default function ContractorLayout() {
  return (
    <PortalShell
      actor="contractor"
      loginPath="/contractor/login"
      titleKey="portalNav.contractorTitle"
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
        { to: "/contractor/photos", labelKey: "portalNav.photos", icon: Camera },
        { to: "/contractor/draws", labelKey: "portalNav.draws", icon: Wallet },
      ]}
    />
  );
}
