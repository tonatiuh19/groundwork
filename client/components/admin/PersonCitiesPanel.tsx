import { useEffect } from "react";
import { MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPersonCities, savePersonCities } from "@/store/slices/citiesSlice";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import { useAdminCan } from "@/hooks/useAdminCan";

/** Cities an affiliate or contractor covers (staff assigned), and what they asked for at sign-up. */
export default function PersonCitiesPanel({ kind, id }: { kind: "affiliate" | "contractor"; id: number }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const data = useAppSelector((s) => s.cities.person[`${kind}:${id}`]);
  const canEdit = useAdminCan("approvals");
  useEffect(() => {
    void dispatch(fetchPersonCities({ kind, id }));
  }, [dispatch, kind, id]);
  if (!data) return null;
  const toggle = (cityId: number) =>
    void dispatch(savePersonCities({ kind, id, assigned: data.assigned.includes(cityId) ? data.assigned.filter((x) => x !== cityId) : [...data.assigned, cityId] }));
  return (
    <section className="pf-section">
      <MultiSearchPicker
        icon={MapPin}
        label={t("cities.coverage")}
        items={data.cities.map((c) => ({ id: c.id, label: c.name }))}
        selected={data.assigned}
        disabled={!canEdit}
        placeholder={t("cities.search")}
        empty={t("cities.none")}
        onToggle={toggle}
      />
      {data.requested.length ? <p className="pf-hint">{t("cities.requested", { names: data.cities.filter((c) => data.requested.includes(c.id)).map((c) => c.name).join(", ") })}</p> : null}
      <p className="pf-hint">{t("cities.coverageHint")}</p>
    </section>
  );
}
