import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useField } from "formik";
import { Trans, useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchLegalStatus } from "@/store/slices/legalSlice";

/**
 * Formik checkbox `accept_terms`: "I agree to the Terms of Service and the Refund & Cancellation
 * Policy, and I have read the Privacy Policy." Shown (and required) only once the Terms are
 * published; the server records which versions were accepted.
 */
export default function TermsConsentField({ name = "accept_terms" }: { name?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.legal.status);
  const nonce = useAppSelector((s) => s.legal.statusNonce);
  const live = Boolean(status?.terms || status?.refunds);
  const [field, meta, helpers] = useField<boolean>({
    name,
    validate: (v) => (live && v !== true ? t("legal.acceptRequired") : undefined),
  });

  // Check on every form view and whenever the tab comes back, so a form opened before the Terms were
  // published shows the checkbox instead of failing with "please accept".
  useEffect(() => {
    void dispatch(fetchLegalStatus());
    const onShow = () => {
      if (document.visibilityState === "visible") void dispatch(fetchLegalStatus());
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [dispatch, nonce]);

  if (!live) return null;
  const link = (to: string) => <Link to={to} target="_blank" rel="noopener" className="text-link" onClick={(e) => e.stopPropagation()} />;
  return (
    <div className="terms-consent">
      <label className="consent">
        <input
          type="checkbox"
          name={name}
          checked={Boolean(field.value)}
          onChange={(e) => void helpers.setValue(e.target.checked)}
          onBlur={field.onBlur}
          aria-invalid={Boolean(meta.touched && meta.error)}
        />
        <span>
          <Trans i18nKey="legal.acceptLabel" components={{ terms: link("/terms"), refunds: link("/refund-policy"), privacy: link("/privacy") }} />
        </span>
      </label>
      {meta.touched && meta.error ? <span className="form-error">{meta.error}</span> : null}
    </div>
  );
}
