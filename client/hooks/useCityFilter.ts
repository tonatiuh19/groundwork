import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchAdminCities } from "@/store/slices/citiesSlice";

/** Options for the admin "All cities" filter (every city, so hidden ones still find older records). */
export function useCityFilterOptions() {
  const dispatch = useAppDispatch();
  const cities = useAppSelector((s) => s.cities.adminList);
  useEffect(() => {
    void dispatch(fetchAdminCities());
  }, [dispatch]);
  return cities.map((c) => ({ value: c.id, label: c.name }));
}
