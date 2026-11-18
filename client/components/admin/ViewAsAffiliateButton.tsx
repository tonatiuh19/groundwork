import { useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { viewAsAffiliate } from "@/store/slices/adminPortalSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";

/** Super admin: open this affiliate's portal read-only in a new tab (30 minutes). Hidden for everyone else. */
export default function ViewAsAffiliateButton({ id, firstName, status }: { id: number; firstName: string; status: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const isSuper = useAppSelector((s) => s.portalAuth.admin.user?.role === "super_admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isSuper) return null;
  const canView = status === "active" || status === "prospect";
  return (
    <>
      <BusyButton
        icon={MonitorSmartphone}
        label={t("affViewAs.button", { name: firstName })}
        busy={busy}
        disabled={!canView}
        title={canView ? t("affViewAs.hint") : t("errors.viewAsInactive")}
        onClick={async () => {
          setError(null);
          setBusy(true);
          // Open the tab right away (popup blockers allow it), then point it at the portal.
          const tab = window.open("about:blank", "_blank");
          const r = await dispatch(viewAsAffiliate(id));
          setBusy(false);
          if (viewAsAffiliate.fulfilled.match(r)) {
            if (tab) tab.location.href = r.payload.url;
            else window.location.href = r.payload.url;
          } else {
            tab?.close();
            setError(String(r.payload || "errors.server"));
          }
        }}
      />
      <ErrorNote error={error} />
    </>
  );
}
