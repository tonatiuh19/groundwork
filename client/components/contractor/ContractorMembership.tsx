import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BadgeDollarSign, ShieldCheck } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  activateApplicationCard,
  activateContractorCard,
  fetchApplicationBilling,
  fetchContractorBilling,
  setContractorBillingCancel,
  setContractorCardError,
  startApplicationCardSetup,
  startContractorCardSetup,
} from "@/store/slices/contractorBillingSlice";
import BillingPanel from "@/components/billing/BillingPanel";
import { Loading } from "@/components/portal/kit";
import { cn } from "@/lib/cn";

/**
 * Contractor platform membership. Three places, one look:
 * - "application": card saved in the prequalification wizard (magic-link token); free period starts on approval.
 * - "gate": the portal is paused until the membership is in good standing.
 * - "portal": manage card / cancel from the dashboard.
 */
export default function ContractorMembership({
  mode,
  token,
  name = "",
  email = "",
}: {
  mode: "application" | "gate" | "portal";
  token?: string;
  name?: string;
  email?: string;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { application, portal, busy, error } = useAppSelector((s) => s.contractorBilling);
  const user = useAppSelector((s) => s.portalAuth.contractor.user);
  const billing = mode === "application" ? application : portal;

  useEffect(() => {
    if (mode === "application" && token) void dispatch(fetchApplicationBilling(token));
    else if (mode !== "application") void dispatch(fetchContractorBilling());
  }, [dispatch, mode, token]);

  if (!billing) return <Loading />;
  if (mode === "portal" && !billing.configured) return null;

  const card = {
    name: name || (user ? `${user.first_name} ${user.last_name}`.trim() : ""),
    email: email || user?.email || "",
    busy,
    error,
    fail: (m: string) => dispatch(setContractorCardError(m)),
    ...(mode === "application" && token
      ? {
          setup: async () => {
            const r = await dispatch(startApplicationCardSetup(token));
            return startApplicationCardSetup.fulfilled.match(r) ? r.payload.client_secret : null;
          },
          activate: async (setup_intent_id: string) =>
            activateApplicationCard.fulfilled.match(await dispatch(activateApplicationCard({ token, setup_intent_id }))),
        }
      : {
          setup: async () => {
            const r = await dispatch(startContractorCardSetup());
            return startContractorCardSetup.fulfilled.match(r) ? r.payload.client_secret : null;
          },
          activate: async (setup_intent_id: string) =>
            activateContractorCard.fulfilled.match(await dispatch(activateContractorCard({ setup_intent_id }))),
        }),
  };

  return (
    <section className={cn("pf-section gw-membership", `gw-membership--${mode}`)} aria-labelledby="gw-membership-title">
      <div className="gw-membership__head">
        <span className="gw-membership__icon" aria-hidden>
          {mode === "gate" ? <ShieldCheck size={20} /> : <BadgeDollarSign size={20} />}
        </span>
        <div>
          <h2 id="gw-membership-title" className="pf-h2">
            {t(`ctrBilling.title.${mode}`)}
          </h2>
          <p className="pf-hint">{t(`ctrBilling.lead.${mode}`)}</p>
        </div>
      </div>
      <BillingPanel
        billing={billing}
        card={card}
        onCancel={mode === "portal" ? (resume) => void dispatch(setContractorBillingCancel({ resume })) : undefined}
      />
    </section>
  );
}
