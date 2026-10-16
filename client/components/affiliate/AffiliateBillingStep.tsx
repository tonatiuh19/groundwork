import { useTranslation } from "react-i18next";
import type { AffiliateBilling } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { activateCard, setBillingCancel, setCardError, startCardSetup } from "@/store/slices/affiliateOnboardingSlice";
import BillingPanel from "@/components/billing/BillingPanel";

/**
 * Step 3 — card on file (affiliate wiring for the shared BillingPanel).
 * Portal mode adds cancel / resume at the end of the paid month (Section 3).
 */
export default function AffiliateBillingStep({
  billing,
  locked,
  mode,
}: {
  billing: AffiliateBilling;
  locked: boolean;
  mode: "portal" | "welcome";
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { cardBusy, cardError } = useAppSelector((s) => s.affiliateOnboarding);
  const me = useAppSelector((s) => s.affiliateOnboarding.portal?.affiliate);
  return (
    <BillingPanel
      billing={billing}
      lockedNote={locked ? t("affBilling.afterAgreement") : null}
      onCancel={mode === "portal" ? (resume) => void dispatch(setBillingCancel({ resume })) : undefined}
      card={{
        name: me ? `${me.first_name} ${me.last_name}`.trim() : "",
        email: me?.email || "",
        busy: cardBusy,
        error: cardError,
        setup: async () => {
          const r = await dispatch(startCardSetup());
          return startCardSetup.fulfilled.match(r) ? r.payload.client_secret : null;
        },
        activate: async (setup_intent_id) => activateCard.fulfilled.match(await dispatch(activateCard({ setup_intent_id }))),
        fail: (m) => dispatch(setCardError(m)),
      }}
    />
  );
}
