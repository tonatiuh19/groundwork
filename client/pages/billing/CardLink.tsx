import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Link2Off } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { activateCardLink, fetchCardLink, setCardLinkError, startCardLinkSetup } from "@/store/slices/billingAdminSlice";
import BillingPanel from "@/components/billing/BillingPanel";
import { Loading } from "@/components/portal/kit";
import PageMeta from "@/components/PageMeta";
import { useFormatters } from "@/lib/format";

/** /billing/card/:token — the secure link staff send so a member can add a card and start their membership. */
export default function BillingCardLinkPage() {
  const { token = "" } = useParams();
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const { link, linkError, linkBusy, linkCardError, linkDone } = useAppSelector((s) => s.billingAdmin);

  useEffect(() => {
    void dispatch(fetchCardLink(token));
  }, [dispatch, token]);

  const portal = link?.member.role === "affiliate" ? "/affiliate/login" : "/contractor/login";
  return (
    <div className="enroll-layout enroll-layout--center">
      <PageMeta title={t("billLink.title")} description={t("billLink.lead")} noIndex />
      <section className="pf-section gw-membership gw-membership--gate gw-cardlink">
        {linkError ? (
          <div className="gw-cardlink__state">
            <Link2Off size={34} aria-hidden />
            <h1 className="pf-h2">{t("billLink.invalidTitle")}</h1>
            <p className="pf-hint">{t("billLink.invalidLead")}</p>
          </div>
        ) : !link ? (
          <Loading />
        ) : linkDone ? (
          <div className="gw-cardlink__state">
            <BadgeCheck size={34} aria-hidden />
            <h1 className="pf-h2">{t("billLink.doneTitle")}</h1>
            <p className="pf-hint">
              {linkDone.status === "trialing" && linkDone.trial_ends_at
                ? t("billLink.doneTrial", { date: fmt.date(linkDone.trial_ends_at) })
                : t("billLink.doneActive")}
            </p>
            <a className="button button-gold" href={portal}>
              {t("billLink.openPortal")}
            </a>
          </div>
        ) : (
          <>
            <h1 className="pf-h2">{t("billLink.hello", { name: link.member.first_name })}</h1>
            <p className="pf-hint">{t("billLink.lead")}</p>
            <BillingPanel
              billing={link.billing}
              card={{
                name: `${link.member.first_name} ${link.member.last_name}`.trim(),
                email: link.member.email,
                busy: linkBusy,
                error: linkCardError,
                fail: (m) => dispatch(setCardLinkError(m)),
                setup: async () => {
                  const r = await dispatch(startCardLinkSetup(token));
                  return startCardLinkSetup.fulfilled.match(r) ? r.payload.client_secret : null;
                },
                activate: async (setup_intent_id) => activateCardLink.fulfilled.match(await dispatch(activateCardLink({ token, setup_intent_id }))),
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
