import { useEffect, useState } from "react";
import { BadgeCheck, Download, FileSignature, PartyPopper } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCityOnboarding, signCityAgreement, submitCityW9 } from "@/store/slices/cityPartnerSlice";
import { BusyButton, ErrorNote, PageHeader } from "@/components/portal/kit";
import W9Form from "@/components/onboarding/W9Form";
import { KitEmpty, KitSkeleton, SetupStepper } from "@/components/partnerKit/PartnerKit";
import { useFormatters } from "@/lib/format";

/** City Partner setup as a guided 3-step flow: sign the agreement, W-9, Groundwork countersigns. */
export default function CityAgreement() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { onboarding: o, loading, saving, error } = useAppSelector((s) => s.cityPartner);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  // Business address for agreements that have a place for it (frozen into the signed copy).
  const [addr, setAddr] = useState({ line: "", city: "", zip: "" });
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    void dispatch(fetchCityOnboarding());
  }, [dispatch]);
  if (loading && !o) return <div className="portal-page"><KitSkeleton rows={3} /></div>;
  if (!o) return <div className="portal-page"><ErrorNote error={error} /></div>;
  const signed = Boolean(o.agreement);
  const w9Done = Boolean(o.w9 && o.w9.status !== "rejected");
  const counter = Boolean(o.agreement?.countersigned_at);
  const allDone = signed && w9Done && counter;

  const signStep = o.template ? (
    <div className="pf-form">
      {changed ? <p className="gw-qr-warn">{t("errors.agreementChanged")}</p> : null}
      <div className="gw-city-agreement" tabIndex={0}>{o.template.body}</div>
      <div className="pf-form-grid">
        <label className="pf-field">
          <span>{t("cityPartner.signerName")}</span>
          <input value={name} maxLength={200} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="pf-field">
          <span>{t("cityPartner.signerTitle")}</span>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
      </div>
      {o.template.needs_address ? (
        <fieldset className="gw-city-address">
          <legend>{t("cityPartner.businessAddress")}</legend>
          <label className="pf-field">
            <span>{t("cityPartner.addressLine")}</span>
            <input value={addr.line} maxLength={200} autoComplete="street-address" onChange={(e) => setAddr({ ...addr, line: e.target.value })} />
          </label>
          <div className="pf-form-grid">
            <label className="pf-field">
              <span>{t("cityPartner.addressCity")}</span>
              <input value={addr.city} maxLength={100} autoComplete="address-level2" onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("cityPartner.addressZip")}</span>
              <input value={addr.zip} maxLength={10} inputMode="numeric" autoComplete="postal-code" onChange={(e) => setAddr({ ...addr, zip: e.target.value })} />
            </label>
          </div>
          <p className="pf-hint">{t("cityPartner.addressHint")}</p>
        </fieldset>
      ) : null}
      <label className="gw-check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("cityPartner.esignConsent")}</span>
      </label>
      <ErrorNote error={changed ? null : error} />
      <div className="pf-actions">
        <BusyButton
          tone="gold"
          icon={FileSignature}
          label={t("cityPartner.sign")}
          busy={saving}
          disabled={!consent || name.trim().length < 2 || (Boolean(o.template.needs_address) && (addr.line.trim().length < 4 || addr.city.trim().length < 2 || !/^\d{5}(-\d{4})?$/.test(addr.zip.trim())))}
          onClick={async () => {
            const r = await dispatch(
              signCityAgreement({
                signer_name: name.trim(),
                signer_title: title.trim(),
                consent: true,
                text_sha256: o.template!.sha256,
                ...(o.template!.needs_address ? { address_line: addr.line.trim(), address_city: addr.city.trim(), address_zip: addr.zip.trim() } : {}),
              }),
            );
            // Text changed while reading: show the new version before they sign.
            if (signCityAgreement.rejected.match(r) && r.payload === "errors.agreementChanged") {
              setChanged(true);
              setConsent(false);
              void dispatch(fetchCityOnboarding());
            }
          }}
        />
      </div>
    </div>
  ) : (
    <p className="pf-hint">{t("cityPartner.agreementNotReady")}</p>
  );

  return (
    <div className="portal-page">
      <PageHeader titleKey="cityPartner.navAgreement" leadKey="cityPartner.agreementLead" />
      {allDone ? (
        <section className="pf-card">
          <KitEmpty icon={PartyPopper} title={t("cityPartner.allSetTitle")} text={t("cityPartner.allSetText")} />
        </section>
      ) : null}
      <section className="pf-card">
        <SetupStepper
          progressLabel={(done, total) => t("cityPartner.setupProgress", { done, total })}
          steps={[
            { key: "sign", title: t("cityPartner.step1"), hint: signed ? t("cityPartner.youSigned", { date: fmt.date(o.agreement!.signed_at) }) : t("cityPartner.step1Hint"), done: signed, content: signStep },
            {
              key: "w9",
              title: t("cityPartner.step2"),
              hint: w9Done ? `${t("cityPartner.w9OnFile", { type: o.w9!.tin_type.toUpperCase(), last4: o.w9!.tin_last4 })} · ${t(`cityPartner.w9Status.${o.w9!.status}`)}` : o.w9?.status === "rejected" ? t("cityPartner.w9Rejected", { note: o.w9.review_note || "" }) : t("cityPartner.step2Hint"),
              done: w9Done,
              content: (
                <W9Form
                  defaultLegalName={o.partner.company || `${o.partner.first_name} ${o.partner.last_name}`.trim()}
                  defaultBusinessName=""
                  submitting={saving}
                  error={error}
                  onSubmit={async (body) => {
                    await dispatch(submitCityW9(body));
                  }}
                />
              ),
            },
            {
              key: "counter",
              title: t("cityPartner.step3"),
              hint: counter ? t("cityPartner.countersignedBy", { name: o.agreement!.countersigner_name, date: fmt.date(o.agreement!.countersigned_at) }) : t("cityPartner.awaitingCountersign"),
              done: counter,
              waiting: signed && !counter,
              content: <p className="pf-hint">{t("cityPartner.step3Hint")}</p>,
            },
          ]}
        />
      </section>
      {signed ? (
        <section className="pf-card gw-city-downloads">
          <h2 className="pk-card-title"><BadgeCheck size={18} aria-hidden /> {t("cityPartner.documents")}</h2>
          <div className="pf-actions">
            <a className="pf-btn" href="/api/city/agreement/pdf" target="_blank" rel="noreferrer"><Download size={15} aria-hidden /> {t("cityPartner.downloadPdf")}</a>
            {w9Done ? <a className="pf-btn" href="/api/city/onboarding/w9/pdf" target="_blank" rel="noreferrer"><Download size={15} aria-hidden /> {t("cityPartner.viewW9")}</a> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
