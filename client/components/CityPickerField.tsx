import { useEffect } from "react";
import { MapPin } from "lucide-react";
import { useField } from "formik";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPublicCities } from "@/store/slices/citiesSlice";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";

/** Optional city search picker for public forms (Formik field `city_ids`). Hidden until cities exist. */
export default function CityPickerField({ labelKey, single }: { labelKey: string; single?: boolean }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const cities = useAppSelector((s) => s.cities.publicList);
  const [field, , helpers] = useField<number[]>("city_ids");
  const value = field.value || [];
  useEffect(() => {
    void dispatch(fetchPublicCities());
  }, [dispatch]);
  if (!cities.length) return null;
  return (
    <MultiSearchPicker
      icon={MapPin}
      label={`${t(labelKey)} (${t("cities.optional")})`}
      items={cities.map((c) => ({ id: c.id, label: c.name }))}
      selected={value}
      placeholder={t("cities.search")}
      onToggle={(id) => {
        if (value.includes(id)) void helpers.setValue(value.filter((x) => x !== id));
        else void helpers.setValue(single ? [id] : [...value, id]);
      }}
    />
  );
}
