import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, FileDown, FileSignature } from "lucide-react";
import type { AffiliateAddendum } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMyAddenda, signMyAddendum } from "@/store/slices/addendaSlice";
import { BusyButton, ErrorNote, StatusBadge } from "@/components/portal/kit";
import SignaturePad from "@/components/portal/SignaturePad";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import { useFormatters } from "@/lib/format";

/** SHA-256 (hex) of the exact text shown, so the server knows they signed what they saw. */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function SignForm({ a }: { a: AffiliateAddendum }) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { busy, error } = useAppSelector((s) => s.addenda);
  const [lang, setLang] = useState<"en" | "es">(i18n.language?.startsWith("es") ? "es" : "en");
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const text = (lang === "es" ? a.rendered_es : a.rendered_en) || "";
  const ready = name.trim().length >= 2 && Boolean(sig) && consent;
  const sign = async () => {
    if (!ready || !sig) return;
    await dispatch(signMyAddendum({ id: a.id, lang, text_sha256: await sha256Hex(text), signed_name: name.trim(), signature_image: sig, consent: true }));
  };
  return (
    <div className="gw-aff-addendum">
      <div className="gw-addendum-lang" role="tablist" aria-label={t("addendum.docLanguage")}>
        {(["en", "es"] as const).map((l) => (
          <button key={l} type="button" role="tab" aria-selected={lang === l} className={lang === l ? "is-on" : undefined} onClick={() => setLang(l)}>
            {l === "en" ? "English" : "Español"}
          </button>
        ))}
      </div>
      <div className="gw-aff-addendum__doc">
        <AgreementDocument body={text} />
      </div>
      <label className="pf-field">
        <span>{t("addendum.signName")}</span>
        <input value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </label>
      <SignaturePad onChange={setSig} disabled={busy} />
      <label className="gw-check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("addendum.consent")}</span>
      </label>
      <ErrorNote error={error} />
      <div className="pf-actions">
        <BusyButton tone="gold" icon={FileSignature} label={t("addendum.sign")} busy={busy} disabled={!ready} onClick={() => void sign()} />
      </div>
    </div>
  );
}

/**
 * Affiliate portal → Agreement: special agreements (addenda) Groundwork sent. Sign the open one; signed ones
 * show their status and PDF. Nothing shows when there are none.
 */
export default function MyAddenda() {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const dispatch = useAppDispatch();
  const mine = useAppSelector((s) => s.addenda.mine);
  useEffect(() => {
    void dispatch(fetchMyAddenda());
  }, [dispatch]);
  useEffect(() => {
    if (mine?.length && window.location.hash === "#addenda") document.getElementById("addenda")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [Boolean(mine?.length)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mine?.length) return null;
  return (
    <section className="pf-section" id="addenda">
      <div className="pf-section-head">
        <h2 className="pf-h2">
          <FileSignature size={17} aria-hidden /> {t("addendum.myTitle")}
        </h2>
      </div>
      <p className="pf-hint">{t("addendum.myLead")}</p>
      <ul className="gw-addenda__list">
        {mine.map((a) => (
          <li key={a.id} className="gw-addendum-card">
            <div className="gw-addendum-card__head">
              <strong>{a.title}</strong>
              <StatusBadge group="addendum.status" value={a.status} />
            </div>
            <p className="gw-addendum-card__rate">
              {fmt.money(a.rate_cents_per_sqft)} / {t("addendum.sqft")} · {t(`addendum.mode_${a.pay_mode}`)}
            </p>
            {a.status === "sent" ? (
              <SignForm a={a} />
            ) : (
              <>
                <p className="pf-muted gw-addendum-card__when">
                  {a.status === "countersigned" ? (
                    <>
                      <CheckCircle2 size={14} aria-hidden /> {t("addendum.inEffect", { date: a.countersigned_at ? fmt.date(a.countersigned_at) : "" })}
                    </>
                  ) : a.status === "signed" ? (
                    t("addendum.waitingGroundwork")
                  ) : (
                    t("addendum.voidedOn", { date: a.voided_at ? fmt.date(a.voided_at) : "", reason: a.void_reason || "" })
                  )}
                </p>
                <div className="gw-addendum-card__actions">
                  <a className="pf-btn pf-btn--sm" href={`/api/affiliate/addenda/${a.id}/pdf`} target="_blank" rel="noreferrer">
                    <FileDown size={13} aria-hidden /> PDF
                  </a>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
