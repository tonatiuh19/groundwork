import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, Download, FileSignature, Lock, PenLine } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchSignView, submitSignature } from "@/store/slices/constructionAgreementSlice";
import PageMeta from "@/components/PageMeta";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import SignaturePad from "@/components/portal/SignaturePad";
import AgreementDocument from "@/components/affiliate/AgreementDocument";
import { ErrorNote, Loading } from "@/components/portal/kit";
import { cn } from "@/lib/cn";

/**
 * /sign/agreement/:token: client or contractor reviews the ADU construction agreement and signs
 * (typed name + drawn signature + consent). Shows who else has signed; once all three parties
 * have signed, the signed PDF downloads from the same link.
 */
export default function AgreementSign() {
  const { t, i18n } = useTranslation();
  const { token = "" } = useParams();
  const dispatch = useAppDispatch();
  const { sign: v, signLoading, signBusy, signError } = useAppSelector((s) => s.constructionAgreement);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [readAll, setReadAll] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);
  const langSet = useRef(false);

  useEffect(() => {
    void dispatch(fetchSignView(token));
  }, [dispatch, token]);
  useEffect(() => {
    if (!v) return;
    if (!name) setName(v.name);
    if (!title && v.title) setTitle(v.title);
    // Open in the signer's language the first time (they can still switch).
    if (!langSet.current) {
      langSet.current = true;
      if (v.lang && !i18n.language?.startsWith(v.lang)) void i18n.changeLanguage(v.lang);
    }
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = docRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setReadAll(true);
  };
  useEffect(() => {
    // Short screens / already at the bottom: nothing to scroll.
    const el = docRef.current;
    if (el && el.scrollHeight <= el.clientHeight + 40) setReadAll(true);
  }, [v]);

  const submit = () => {
    if (!v || !sig) return;
    void dispatch(
      submitSignature({
        token,
        body: { signed_name: name.trim(), title: v.party === "contractor" ? title.trim() : undefined, signature_image: sig, body_sha256: v.body_sha256, consent: true },
      }),
    );
  };

  const signedByMe = v?.status === "signed";
  const complete = v?.agreement_status === "signed";
  return (
    <div className="gw-sign">
      <PageMeta title={t("agreementSign.metaTitle")} description={t("agreementSign.lead")} canonical="/sign/agreement" noIndex />
      <header className="gw-sign__top">
        <Link to="/" className="gw-sign__logo">
          <img src="/logos/groundwork-logo-white.png" alt="Groundwork Capital" />
        </Link>
        <LanguageSwitcher />
      </header>
      <main className="gw-sign__main">
        {signLoading && !v ? <Loading /> : null}
        {!v && !signLoading ? (
          <div className="gw-sign__card">
            <ErrorNote error={signError || "errors.agreementLink"} />
          </div>
        ) : null}
        {v ? (
          <>
            <section className="gw-sign__hero">
              <p className="eyebrow">
                <span className="eyebrow-line" /> {t("agreementSign.eyebrow")}
              </p>
              <h1>{t("agreementSign.title")}</h1>
              <p className="gw-sign__address">{v.address}</p>
              <ol className="gw-sign__steps" aria-label={t("agreementSign.whoSigns")}>
                {v.signers.map((s) => (
                  <li key={s.party} className={cn(s.status === "signed" && "is-done", s.party === v.party && "is-me")}>
                    {s.status === "signed" ? <CheckCircle2 size={16} aria-hidden /> : <Clock size={16} aria-hidden />}
                    <span>
                      <strong>{t(`agreementSign.party_${s.party}`)}</strong>
                      <small>{s.status === "signed" ? t("agreementSign.signed") : s.party === v.party ? t("agreementSign.you") : t("agreementSign.waiting")}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            {complete ? (
              <section className="gw-sign__card gw-sign__done">
                <CheckCircle2 size={34} aria-hidden />
                <h2>{t("agreementSign.completeTitle")}</h2>
                <p>{t("agreementSign.completeBody")}</p>
                {v.can_download ? (
                  <a className="button button-gold" href={`/api/public/agreement-sign/${token}/pdf`}>
                    <Download size={16} /> {t("agreementSign.download")}
                  </a>
                ) : null}
              </section>
            ) : signedByMe ? (
              <section className="gw-sign__card gw-sign__done">
                <CheckCircle2 size={34} aria-hidden />
                <h2>{t("agreementSign.thanksTitle")}</h2>
                <p>{t("agreementSign.thanksBody")}</p>
              </section>
            ) : null}

            <section className="gw-sign__card">
              {i18n.language?.startsWith("es") ? <p className="gw-sign__note">{t("agreementSign.englishOnly")}</p> : null}
              <div ref={docRef} className="gw-sign__doc" onScroll={onScroll} tabIndex={0} aria-label={t("agreementSign.document")}>
                <AgreementDocument body={v.body} />
              </div>
              {!signedByMe && !complete && v.agreement_status === "sent" ? (
                <p className="pf-hint gw-sign__scrollhint">{readAll ? t("agreementSign.readDone") : t("agreementSign.scrollHint")}</p>
              ) : null}
            </section>

            {!signedByMe && !complete && v.agreement_status === "sent" ? (
              <section className="gw-sign__card gw-sign__form">
                <h2>
                  <FileSignature size={20} aria-hidden /> {t("agreementSign.signTitle")}
                </h2>
                <ErrorNote error={signError} />
                <div className="gw-sign__fields">
                  <label className="pf-field">
                    <span>{t("agreementSign.fullName")}</span>
                    <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
                  </label>
                  {v.party === "contractor" ? (
                    <label className="pf-field">
                      <span>{t("agreementSign.titleField")}</span>
                      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("agreementSign.titlePh")} />
                    </label>
                  ) : null}
                </div>
                <span className="pf-field-label">{t("agreementSign.drawSignature")}</span>
                <SignaturePad onChange={setSig} />
                <label className="consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{t("agreementSign.consent")}</span>
                </label>
                <button type="button" className="button button-gold gw-sign__submit" disabled={!readAll || !consent || !sig || name.trim().length < 3 || signBusy} onClick={submit}>
                  <PenLine size={17} /> {signBusy ? t("agreementSign.signing") : t("agreementSign.submit")}
                </button>
                <p className="gw-sign__secure">
                  <Lock size={13} aria-hidden /> {t("agreementSign.secure")}
                </p>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}
