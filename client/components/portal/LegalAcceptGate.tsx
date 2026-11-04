import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileCheck2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { acceptLegal, fetchLegalPending } from "@/store/slices/legalSlice";

/**
 * Affiliate / contractor portals: when a Terms or Refund policy version needs their acceptance
 * (never accepted, or a version published as "members must accept again"), a blocking notice asks
 * them to read and accept it. Acceptance is recorded with date, IP and browser.
 */
export default function LegalAcceptGate({ actor }: { actor: "affiliate" | "contractor" }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const pending = useAppSelector((s) => s.legal.pending);
  const accepting = useAppSelector((s) => s.legal.accepting);
  const [agree, setAgree] = useState(false);

  useEffect(() => {
    void dispatch(fetchLegalPending(actor));
  }, [dispatch, actor]);

  if (!pending || !pending.length) return null;
  return (
    <div className="legal-gate" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title">
      <div className="legal-gate__card">
        <span className="legal-gate__icon" aria-hidden>
          <FileCheck2 size={22} />
        </span>
        <h2 id="legal-gate-title">{t("legal.gateTitle")}</h2>
        <p>{t("legal.gateLead")}</p>
        <ul className="legal-gate__list">
          {pending.map((p) => (
            <li key={p.slug}>
              <Link to={p.path} target="_blank" rel="noopener" className="text-link">
                {p.title}
              </Link>
              {p.effective_date ? <small>{t("legal.effective", { date: p.effective_date })}</small> : null}
            </li>
          ))}
          <li>
            <Link to="/privacy" target="_blank" rel="noopener" className="text-link">
              {t("legal.title_privacy")}
            </Link>
          </li>
        </ul>
        <label className="consent">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{t("legal.gateAgree")}</span>
        </label>
        <button type="button" className="button button-gold" disabled={!agree || accepting} onClick={() => void dispatch(acceptLegal(actor))}>
          {accepting ? t("legal.accepting") : t("legal.accept")}
        </button>
      </div>
    </div>
  );
}
