import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Link2Off, MailCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import EnrollApp from "@/components/enroll/EnrollApp";
import ContractorApplicationWizard from "@/components/contractorApplication/ContractorApplicationWizard";
import { ErrorNote, Loading } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchContractorApplication,
  resendContractorApplicationLink,
  resetResend,
} from "@/store/slices/contractorApplicationSlice";

/** Expired / unknown magic link → request a fresh one (never reveals whether the email exists). */
function LinkExpired() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { sending, sent, error } = useAppSelector((s) => s.contractorApplication.resend);
  const [email, setEmail] = useState("");
  useEffect(() => {
    dispatch(resetResend());
  }, [dispatch]);
  return (
    <div className="enroll-layout enroll-layout--center">
      <div className="enroll-inactive cpq-expired">
        {sent ? <MailCheck size={36} aria-hidden /> : <Link2Off size={36} aria-hidden />}
        <h1>{t(sent ? "cpq.expired.sentTitle" : "cpq.expired.title")}</h1>
        <p>{t(sent ? "cpq.expired.sentBody" : "cpq.expired.body")}</p>
        {sent ? null : (
          <form
            className="cpq-expired-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void dispatch(resendContractorApplicationLink(email.trim()));
            }}
          >
            <label className="pf-field">
              <span>{t("form.email")}</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                required
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <ErrorNote error={error} />
            <button type="submit" className="button button-gold" disabled={sending}>
              {t(sending ? "pf.busy.sending" : "cpq.expired.send")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ContractorApply() {
  const { t, i18n } = useTranslation();
  const { token = "" } = useParams();
  const dispatch = useAppDispatch();
  const { view, loading, error } = useAppSelector((s) => s.contractorApplication);
  const lang = i18n.language?.startsWith("es") ? "es" : "en";

  // Refetch on language switch so the certification text matches what the signer reads.
  useEffect(() => {
    void dispatch(fetchContractorApplication({ token, lang }));
  }, [dispatch, token, lang]);

  return (
    <EnrollApp
      title={t("cpq.metaTitle")}
      description={t("cpq.metaDescription")}
      canonical="/contractor/apply"
      noIndex
      productKey="cpq.appTitle"
      subtitleKey="cpq.appSubtitle"
      trustKey="cpq.trustLine"
      hideClose={!view}
    >
      {view ? (
        <ContractorApplicationWizard key={token} token={token} view={view} />
      ) : loading ? (
        <div className="enroll-layout enroll-layout--center">
          <Loading />
        </div>
      ) : error ? (
        <LinkExpired />
      ) : null}
    </EnrollApp>
  );
}
