import { LayoutDashboard, FolderKanban, FileText } from "lucide-react";
import PortalShell from "@/components/portal/PortalShell";

export default function ClientLayout() {
  return (
    <PortalShell
      actor="client"
      loginPath="/client/login"
      titleKey="portalNav.clientTitle"
      nav={[
        { to: "/client", end: true, labelKey: "portalNav.dashboard", icon: LayoutDashboard },
        { to: "/client/project", labelKey: "portalNav.myProject", icon: FolderKanban },
        { to: "/client/documents", labelKey: "portalNav.documents", icon: FileText },
      ]}
    />
  );
}
