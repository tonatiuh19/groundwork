import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { useField } from "formik";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminCities, fetchPublicCities } from "@/store/slices/citiesSlice";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import CityCreateModal from "@/components/admin/CityCreateModal";

/**
 * One city for a record (client, project, contact, event, enroll): picked from the list, never typed.
 * Formik fields: `city_id` (number | "") and the record's old text column (`textName`, e.g. `city`,
 * `property_city`), which mirrors the picked name so addresses, emails and exports keep working.
 * Admins never type: they pick or add a missing city (near-duplicate check). Everyone else can say
 * "my city isn't listed" and type it: saved without a city id, staff tag or add it in Settings → Cities.
 */
export default function CityField({
  textName,
  labelKey = "pf.city",
  admin = false,
  disabled,
  required,
}: {
  textName: string;
  labelKey?: string;
  admin?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const adminList = useAppSelector((s) => s.cities.adminList);
  const publicList = useAppSelector((s) => s.cities.publicList);
  const [idField, idMeta, idHelpers] = useField<number | "" | null>("city_id");
  const [textField, , textHelpers] = useField<string>(textName);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const cities = admin ? adminList.filter((c) => !c.archived) : publicList;
  const selectedId = idField.value ? Number(idField.value) : null;
  // A typed city with no id (older record or "not listed") shows the text box instead of the picker.
  const [unlisted, setUnlisted] = useState(false);

  useEffect(() => {
    void dispatch(admin ? fetchAdminCities() : fetchPublicCities());
  }, [dispatch, admin]);
  useEffect(() => {
    if (!admin && !selectedId && textField.value && cities.length && !cities.some((c) => c.name.toLowerCase() === String(textField.value).trim().toLowerCase())) setUnlisted(true);
  }, [cities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: number | null) => {
    const c = cities.find((x) => x.id === id);
    void idHelpers.setValue(id ?? "");
    void textHelpers.setValue(c ? c.name : "");
    setUnlisted(false);
  };

  return (
    <div className="gw-city-field">
      {!unlisted ? (
        <MultiSearchPicker
          icon={MapPin}
          label={`${t(labelKey)}${required ? " *" : ""}`}
          items={cities.map((c) => ({ id: c.id, label: c.name }))}
          selected={selectedId ? [selectedId] : []}
          disabled={disabled}
          placeholder={t("cities.search")}
          empty={t("cities.none")}
          onToggle={(id) => pick(selectedId === id ? null : id)}
          onCreate={admin && !disabled ? (q) => setQuickAdd(q) : undefined}
          createLabel={(q) => (q ? t("cities.addNamed", { name: q }) : t("cities.add"))}
          manageHref={admin ? "/admin/settings#cities" : undefined}
          manageLabel={t("cities.manage")}
        />
      ) : (
        <label className="pf-field">
          <span>{t("cities.unlistedLabel")}</span>
          <input {...textField} value={textField.value || ""} disabled={disabled} maxLength={100} placeholder={t("cities.unlistedPlaceholder")} />
        </label>
      )}
      {admin && !selectedId && textField.value ? <p className="pf-hint">{t("cities.typedBefore", { name: textField.value })}</p> : null}
      {!disabled && !admin ? (
        <button
          type="button"
          className="text-link gw-city-field__toggle"
          onClick={() => {
            if (unlisted) {
              setUnlisted(false);
              void textHelpers.setValue("");
            } else {
              setUnlisted(true);
              void idHelpers.setValue("");
            }
          }}
        >
          {unlisted ? t("cities.pickFromList") : t("cities.notListed")}
        </button>
      ) : null}
      {unlisted ? <p className="pf-hint">{t("cities.unlistedHint")}</p> : null}
      {idMeta.touched && idMeta.error ? <span className="form-error">{idMeta.error}</span> : null}
      {admin ? <CityCreateModal initialName={quickAdd} onClose={() => setQuickAdd(null)} onPicked={(id) => { void dispatch(fetchAdminCities()).then(() => pick(id)); }} /> : null}
    </div>
  );
}
