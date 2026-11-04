import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchCityOnboarding, updateCityProfile } from "@/store/slices/cityPartnerSlice";
import { fetchPortalMe } from "@/store/slices/portalAuthSlice";
import { BusyButton, ErrorNote, PageHeader } from "@/components/portal/kit";
import { KitSkeleton } from "@/components/partnerKit/PartnerKit";

/** City Partner: own contact details. The LLC name and rate are in the agreement, so only staff change them. */
export default function CityProfile() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { onboarding: o, saving, error } = useAppSelector((s) => s.cityPartner);
  const [f, setF] = useState({ first_name: "", last_name: "", phone: "", preferred_language: "en" });
  const [done, setDone] = useState(false);
  useEffect(() => {
    void dispatch(fetchCityOnboarding());
  }, [dispatch]);
  useEffect(() => {
    if (o) setF({ first_name: o.partner.first_name, last_name: o.partner.last_name, phone: o.partner.phone || "", preferred_language: o.partner.preferred_language });
  }, [o]);
  if (!o) return <div className="portal-page"><KitSkeleton layout="form" rows={4} /></div>;
  return (
    <div className="portal-page">
      <PageHeader titleKey="cityPartner.navProfile" leadKey="cityPartner.profileLead" />
      <section className="pf-card pf-form">
        <ErrorNote error={error} />
        <div className="pf-form-grid">
          <label className="pf-field">
            <span>{t("form.firstName")}</span>
            <input value={f.first_name} maxLength={100} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          </label>
          <label className="pf-field">
            <span>{t("form.lastName")}</span>
            <input value={f.last_name} maxLength={100} onChange={(e) => setF({ ...f, last_name: e.target.value })} />
          </label>
        </div>
        <label className="pf-field">
          <span>{t("form.phone")}</span>
          <input type="tel" value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </label>
        <label className="pf-field">
          <span>{t("cityPartner.language")}</span>
          <select value={f.preferred_language} onChange={(e) => setF({ ...f, preferred_language: e.target.value })}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </label>
        <p className="pf-hint">{t("cityPartner.profileLocked", { company: o.partner.company || "" })}</p>
        <div className="pf-actions">
          <BusyButton
            tone="gold"
            label={t("pf.save")}
            doneLabel={t("cityPartner.saved")}
            done={done}
            busy={saving}
            disabled={!f.first_name.trim()}
            onClick={async () => {
              setDone(false);
              const r = await dispatch(updateCityProfile(f));
              if (updateCityProfile.fulfilled.match(r)) {
                setDone(true);
                void dispatch(fetchPortalMe("city"));
              }
            }}
          />
        </div>
      </section>
    </div>
  );
}
