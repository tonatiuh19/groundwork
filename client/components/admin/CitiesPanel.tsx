import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, GitMerge, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ServiceCity } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { archiveCity, assignRecordCity, deleteCity, fetchAdminCities, fetchCityGrid, fetchCitySuggestions, fetchCityUsage, mergeCity, updateCity, type CityUsage } from "@/store/slices/citiesSlice";
import { BusyButton, DataTable, ErrorNote, FilterSelect, ListPager, SearchBox } from "@/components/portal/kit";
import { Modal } from "@/components/portal/Modal";
import DangerConfirmModal from "@/components/portal/DangerConfirmModal";
import CityCreateModal from "@/components/admin/CityCreateModal";

const PAGE = 25;
type Pending = { kind: "rename" | "merge" | "delete" | "archive"; city: ServiceCity; usage?: CityUsage } | null;

/** Settings → Cities: the one clean list behind every picker. Server-side grid; rename, hide, archive, merge, delete. */
export default function CitiesPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { grid, gridLoading, adminList, suggestions, saving, error } = useAppSelector((s) => s.cities);
  const [f, setF] = useState({ q: "", status: "" });
  const [offset, setOffset] = useState(0);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [newName, setNewName] = useState("");
  const [into, setInto] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const load = () => void dispatch(fetchCityGrid({ ...f, limit: PAGE, offset }));
  const refresh = () => {
    load();
    void dispatch(fetchAdminCities());
    void dispatch(fetchCitySuggestions());
  };
  useEffect(load, [dispatch, f, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void dispatch(fetchAdminCities());
    void dispatch(fetchCitySuggestions());
  }, [dispatch]);
  const set = (k: keyof typeof f) => (v: string) => {
    setOffset(0);
    setF({ ...f, [k]: v });
  };
  const open = async (kind: NonNullable<Pending>["kind"], city: ServiceCity) => {
    setNewName(city.name);
    setInto("");
    const r = kind === "delete" || kind === "merge" || kind === "archive" ? await dispatch(fetchCityUsage(city.id)) : null;
    setPending({ kind, city, usage: r && fetchCityUsage.fulfilled.match(r) ? r.payload.usage : undefined });
  };
  const done = (ok: boolean) => {
    if (ok) {
      setPending(null);
      refresh();
    }
  };
  const usageList = (u?: CityUsage) =>
    u ? (
      <ul>
        {(["leads", "clients", "projects", "fees", "people", "activities"] as const).filter((k) => u[k] > 0).map((k) => (
          <li key={k}>{t(`cities.usage.${k}`, { count: u[k] })}</li>
        ))}
      </ul>
    ) : null;

  return (
    <section className={className} id="cities">
      <div className="pf-section-head">
        <h2 className="pf-h2 gw-cities-title">
          <MapPin size={18} aria-hidden /> {t("cities.title")}
        </h2>
        <BusyButton tone="gold" icon={Plus} label={t("cities.add")} onClick={() => setQuickAdd("")} />
      </div>
      <p className="pf-hint">{t("cities.hint")}</p>
      <div className="pf-filters">
        <SearchBox onSearch={set("q")} />
        <FilterSelect value={f.status} onChange={set("status")} ariaLabel={t("pf.status")} allLabel={t("cities.filterInUse")} options={(["shown", "hidden", "archived"] as const).map((v) => ({ value: v, label: t(`cities.status.${v}`) }))} />
      </div>
      <ErrorNote error={error} />
      <DataTable<ServiceCity>
        rows={grid.cities}
        loading={gridLoading}
        skeleton
        rowKey={(c) => c.id}
        emptyKey="cities.empty"
        columns={[
          { key: "name", headerKey: "cities.colCity", render: (c) => <strong>{c.name}</strong> },
          { key: "counts", headerKey: "cities.colUse", render: (c) => t("cities.counts", { leads: c.lead_count, clients: c.client_count, projects: c.project_count }) },
          { key: "who", headerKey: "cities.colCovered", render: (c) => (c.assigned.length ? c.assigned.join(", ") : "—") },
          {
            key: "status",
            headerKey: "pf.status",
            render: (c) =>
              c.archived ? (
                t("cities.status.archived")
              ) : (
                <label className="gw-qr-card__toggle">
                  <input type="checkbox" checked={c.active} onChange={async (e) => { await dispatch(updateCity({ id: c.id, active: e.target.checked })); refresh(); }} />
                  <span>{t(c.active ? "cities.shown" : "cities.hidden")}</span>
                </label>
              ),
          },
          {
            key: "actions",
            headerKey: "cityPartner.colActions",
            render: (c) => (
              <span className="pf-table-actions">
                <button type="button" className="pf-icon-btn" aria-label={t("cities.rename", { name: c.name })} onClick={() => void open("rename", c)}><Pencil size={14} /></button>
                {c.archived ? (
                  <button type="button" className="pf-icon-btn" aria-label={t("cities.restore", { name: c.name })} onClick={async () => { await dispatch(archiveCity({ id: c.id, archived: false })); refresh(); }}><ArchiveRestore size={14} /></button>
                ) : (
                  <button type="button" className="pf-icon-btn" aria-label={t("cities.archive", { name: c.name })} onClick={() => void open("archive", c)}><Archive size={14} /></button>
                )}
                <button type="button" className="pf-icon-btn" aria-label={t("cities.merge", { name: c.name })} onClick={() => void open("merge", c)}><GitMerge size={14} /></button>
                <button type="button" className="pf-icon-btn" aria-label={t("cities.delete", { name: c.name })} onClick={() => void open("delete", c)}><Trash2 size={14} /></button>
              </span>
            ),
          },
        ]}
      />
      <ListPager total={grid.total} limit={PAGE} offset={offset} onPageChange={setOffset} loading={gridLoading} />

      <Modal open={pending?.kind === "rename"} titleKey="cities.renameTitle" onClose={() => setPending(null)}>
        <div className="pf-form">
          <label className="pf-field">
            <span>{t("cities.name")}</span>
            <input value={newName} maxLength={100} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <p className="pf-hint">{t("cities.renameHint")}</p>
          <ErrorNote error={error} />
          <div className="pf-actions">
            <BusyButton tone="gold" label={t("pf.save")} busy={saving} disabled={!newName.trim() || newName.trim() === pending?.city.name} onClick={async () => done(updateCity.fulfilled.match(await dispatch(updateCity({ id: pending!.city.id, name: newName.trim() }))))} />
          </div>
        </div>
      </Modal>
      <DangerConfirmModal open={pending?.kind === "archive"} titleKey="cities.archiveTitle" confirmLabel={t("cities.archiveConfirm")} busy={saving} error={error} onCancel={() => setPending(null)} onConfirm={async () => done(archiveCity.fulfilled.match(await dispatch(archiveCity({ id: pending!.city.id, archived: true }))))}>
        <p>{t("cities.archiveWarn", { name: pending?.city.name })}</p>
        {usageList(pending?.usage)}
      </DangerConfirmModal>
      <DangerConfirmModal open={pending?.kind === "merge"} titleKey="cities.mergeTitle" confirmText={pending?.city.name} confirmLabel={t("cities.mergeConfirm")} busy={saving} ready={Boolean(into)} error={error} onCancel={() => setPending(null)} onConfirm={async () => into && done(mergeCity.fulfilled.match(await dispatch(mergeCity({ id: pending!.city.id, into_id: Number(into) }))))}>
        <p>{t("cities.mergeWarn", { name: pending?.city.name })}</p>
        {usageList(pending?.usage)}
        <label className="pf-field">
          <span>{t("cities.mergeInto")}</span>
          <select value={into} onChange={(e) => setInto(e.target.value)}>
            <option value="">{t("cities.choose")}</option>
            {adminList.filter((c) => c.id !== pending?.city.id && !c.archived).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </DangerConfirmModal>
      <DangerConfirmModal open={pending?.kind === "delete"} titleKey="cities.deleteTitle" confirmText={pending?.usage?.total ? undefined : pending?.city.name} confirmLabel={t("cities.deleteConfirm")} busy={saving || Boolean(pending?.usage?.total)} error={error} onCancel={() => setPending(null)} onConfirm={async () => done(deleteCity.fulfilled.match(await dispatch(deleteCity(pending!.city.id))))}>
        {pending?.usage?.total ? (
          <>
            <p><strong>{t("cities.deleteBlocked", { name: pending.city.name })}</strong></p>
            {usageList(pending.usage)}
            <p className="pf-hint">{t("cities.deleteBlockedHint")}</p>
          </>
        ) : (
          <p>{t("cities.deleteWarn", { name: pending?.city.name })}</p>
        )}
      </DangerConfirmModal>
      <CityCreateModal initialName={quickAdd} onClose={() => setQuickAdd(null)} onPicked={() => refresh()} />

      {suggestions.length ? (
        <>
          <h3>{t("cities.cleanupTitle", { count: suggestions.length })}</h3>
          <p className="pf-hint">{t("cities.cleanupHint")}</p>
          <ul className="gw-mail-org__list">
            {suggestions.map((r) => {
              const key = `${r.kind}:${r.id}`;
              const value = picked[key] ?? (r.suggested_city_id ? String(r.suggested_city_id) : "");
              return (
                <li key={key}>
                  <span className="gw-mail-org__main">
                    <strong>{r.name}</strong>
                    <small>{t(`cities.kind_${r.kind}`)} · {r.address}</small>
                  </span>
                  <span className="gw-mail-org__acts">
                    <select value={value} aria-label={t("cities.cityFor", { name: r.name })} onChange={(e) => setPicked({ ...picked, [key]: e.target.value })}>
                      <option value="">{t("cities.choose")}</option>
                      {adminList.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <BusyButton label={t("cities.confirm")} disabled={!value} onClick={() => void dispatch(assignRecordCity({ kind: r.kind, id: r.id, city_id: Number(value) }))} />
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
