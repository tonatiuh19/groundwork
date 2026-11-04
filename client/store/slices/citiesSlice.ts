import { createSlice } from "@reduxjs/toolkit";
import type { CitySuggestion, PersonCities, ServiceCity } from "@shared/api";
import { api } from "@/lib/api";
import { createApiThunk } from "@/lib/portalThunk";

/** Cities managed in Settings: public pickers, admin filters, city report, cleanup of older records. */
export const fetchPublicCities = createApiThunk<{ cities: { id: number; name: string }[] }, void>("cities/public", null, async () => (await api.get("/public/cities")).data);
export const fetchAdminCities = createApiThunk<{ cities: ServiceCity[] }, void>("cities/admin", "admin", async () => (await api.get("/admin/cities")).data);
export const createCity = createApiThunk<{ cities: ServiceCity[] }, string>("cities/create", "admin", async (name) => (await api.post("/admin/cities", { name })).data);
export const updateCity = createApiThunk<{ cities: ServiceCity[] }, { id: number; name?: string; active?: boolean }>("cities/update", "admin", async ({ id, ...body }) => (await api.patch(`/admin/cities/${id}`, body)).data);
export type CityUsage = { leads: number; clients: number; projects: number; fees: number; people: number; activities: number; total: number };
export const fetchCityGrid = createApiThunk<{ cities: ServiceCity[]; total: number }, { q?: string; status?: string; limit: number; offset: number }>("cities/grid", "admin", async (params) => (await api.get("/admin/cities", { params: { ...params, paged: 1 } })).data);
export const fetchSimilarCities = createApiThunk<{ matches: { id: number; name: string; archived: boolean }[] }, string>("cities/similar", "admin", async (name) => (await api.get("/admin/cities/similar", { params: { name } })).data);
export const addCity = createApiThunk<{ id: number; cities: ServiceCity[] }, string>("cities/add", "admin", async (name) => (await api.post("/admin/cities", { name })).data);
export const fetchCityUsage = createApiThunk<{ usage: CityUsage }, number>("cities/usage", "admin", async (id) => (await api.get(`/admin/cities/${id}/usage`)).data);
export const archiveCity = createApiThunk<{ ok: true }, { id: number; archived: boolean }>("cities/archive", "admin", async ({ id, archived }) => (await api.post(`/admin/cities/${id}/archive`, { archived })).data);
export const mergeCity = createApiThunk<{ ok: true }, { id: number; into_id: number }>("cities/merge", "admin", async ({ id, into_id }) => (await api.post(`/admin/cities/${id}/merge`, { into_id })).data);
export const deleteCity = createApiThunk<{ ok: true }, number>("cities/delete", "admin", async (id) => (await api.delete(`/admin/cities/${id}`)).data);
export const fetchCitySuggestions = createApiThunk<{ records: CitySuggestion[] }, void>("cities/suggestions", "admin", async () => (await api.get("/admin/cities/suggestions")).data);
export const assignRecordCity = createApiThunk<{ ok: true }, { kind: CitySuggestion["kind"]; id: number; city_id: number }>("cities/assign", "admin", async (body) => (await api.post("/admin/cities/assign", body)).data);
export const fetchPersonCities = createApiThunk<PersonCities, { kind: "affiliate" | "contractor"; id: number }>("cities/person", "admin", async ({ kind, id }) => (await api.get(`/admin/cities/people/${kind}/${id}`)).data);
export const savePersonCities = createApiThunk<PersonCities, { kind: "affiliate" | "contractor"; id: number; assigned: number[] }>("cities/personSave", "admin", async ({ kind, id, assigned }) => (await api.put(`/admin/cities/people/${kind}/${id}`, { assigned })).data);

type State = {
  publicList: { id: number; name: string }[];
  adminList: ServiceCity[];
  grid: { cities: ServiceCity[]; total: number };
  gridLoading: boolean;
  suggestions: CitySuggestion[];
  person: Record<string, PersonCities>;
  saving: boolean;
  error: string | null;
};
const initialState: State = { publicList: [], adminList: [], grid: { cities: [], total: 0 }, gridLoading: false, suggestions: [], person: {}, saving: false, error: null };

const slice = createSlice({
  name: "cities",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchPublicCities.fulfilled, (s, a) => {
      s.publicList = a.payload.cities;
    })
      .addCase(fetchAdminCities.fulfilled, (s, a) => {
        s.adminList = a.payload.cities;
      })
      .addCase(fetchCityGrid.pending, (s) => {
        s.gridLoading = true;
      })
      .addCase(fetchCityGrid.fulfilled, (s, a) => {
        s.gridLoading = false;
        s.grid = a.payload;
      })
      .addCase(fetchCityGrid.rejected, (s, a) => {
        s.gridLoading = false;
        s.error = a.payload || "errors.server";
      })
      .addCase(fetchCitySuggestions.fulfilled, (s, a) => {
        s.suggestions = a.payload.records;
      })
      .addCase(assignRecordCity.fulfilled, (s, a) => {
        s.suggestions = s.suggestions.filter((r) => !(r.kind === a.meta.arg.kind && r.id === a.meta.arg.id));
      })
      .addCase(fetchPersonCities.fulfilled, (s, a) => {
        s.person[`${a.meta.arg.kind}:${a.meta.arg.id}`] = a.payload;
      })
      .addCase(savePersonCities.fulfilled, (s, a) => {
        s.person[`${a.meta.arg.kind}:${a.meta.arg.id}`] = a.payload;
      });
    for (const th of [createCity, updateCity, addCity, archiveCity, mergeCity, deleteCity] as const) {
      b.addCase(th.pending, (s) => {
        s.saving = true;
        s.error = null;
      })
        .addCase(th.fulfilled, (s, a) => {
          s.saving = false;
          const p = a.payload as { cities?: ServiceCity[] };
          if (p.cities) s.adminList = p.cities;
        })
        .addCase(th.rejected, (s, a) => {
          s.saving = false;
          s.error = a.payload || "errors.server";
        });
    }
  },
});

export default slice.reducer;
