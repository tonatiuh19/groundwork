import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Briefcase, FolderKanban, Handshake, HardHat, Inbox, MapPinned, RotateCcw, Settings2, Users, type LucideIcon } from "lucide-react";
import type { NotifyArea, NotifyRoutingArea } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchNotifyRouting, saveNotifyRouting } from "@/store/slices/notifyRoutingSlice";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import { cn } from "@/lib/cn";
import { KitSkeleton } from "@/components/partnerKit/PartnerKit";

const AREA_ICON: Record<NotifyArea, LucideIcon> = {
  leads: Inbox,
  clients: Users,
  contractors: HardHat,
  affiliates: Handshake,
  city_partners: MapPinned,
  projects: FolderKanban,
  system: Settings2,
};

/**
 * Settings → "Who gets what": each notification area goes to chosen staff
 * (+ the person assigned to the record). Not set up = super admins only.
 * Each person's own preferences still pick email / bell / text.
 */
export function NotifyRoutingPanel({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { data, loading, saving, error } = useAppSelector((s) => s.notifyRouting);
  useEffect(() => {
    void dispatch(fetchNotifyRouting());
  }, [dispatch]);

  return (
    <section className={cn("gw-route", className)}>
      <header className="gw-route__head">
        <Briefcase size={18} aria-hidden />
        <div>
          <h2>{t("notifyRouting.title")}</h2>
          <p className="pf-muted">{t("notifyRouting.lead")}</p>
        </div>
      </header>
      <ErrorNote error={error} />
      {loading && !data ? <KitSkeleton layout="list" rows={3} /> : null}
      <div className="gw-route__grid">
        {data?.areas.map((a) => (
          <AreaCard key={a.area} area={a} staff={data.staff} saving={saving === a.area} onSave={(body) => void dispatch(saveNotifyRouting({ areas: [body] }))} />
        ))}
      </div>
    </section>
  );
}

function AreaCard({
  area,
  staff,
  saving,
  onSave,
}: {
  area: NotifyRoutingArea;
  staff: Array<{ id: number; name: string; email: string; role: string | null }>;
  saving: boolean;
  onSave: (body: { area: NotifyArea; admin_ids: number[]; include_owner: boolean } | { area: NotifyArea; reset: true }) => void;
}) {
  const { t } = useTranslation();
  const [ids, setIds] = useState<number[]>(area.admin_ids);
  const [owner, setOwner] = useState(area.include_owner);
  useEffect(() => {
    setIds(area.admin_ids);
    setOwner(area.include_owner);
  }, [area]);
  const dirty = useMemo(
    () => JSON.stringify([...ids].sort()) !== JSON.stringify([...area.admin_ids].sort()) || owner !== area.include_owner || !area.configured,
    [ids, owner, area],
  );
  const Icon = AREA_ICON[area.area];
  return (
    <article className={cn("gw-route__card", !area.configured && "is-default")}>
      <div className="gw-route__title">
        <span className="gw-route__icon" aria-hidden>
          <Icon size={16} />
        </span>
        <div>
          <h3>{t(`notifyRouting.area.${area.area}`)}</h3>
          <small>{area.configured ? t("notifyRouting.configured", { count: area.admin_ids.length }) : t("notifyRouting.notConfigured")}</small>
        </div>
      </div>
      <ul className="gw-route__events">
        {area.events.map((e) => (
          <li key={e}>{t(`admin.notifyEvents.${e}`)}</li>
        ))}
      </ul>
      <MultiSearchPicker
        icon={Users}
        label={t("notifyRouting.who")}
        items={staff.map((s) => ({ id: s.id, label: s.name || s.email, sub: [s.email, s.role ? t(`role.${s.role}`, { defaultValue: s.role }) : null].filter(Boolean).join(" · ") }))}
        selected={ids}
        onToggle={(id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])}
        placeholder={t("notifyRouting.search")}
      />
      {area.area !== "leads" && area.area !== "system" && area.area !== "city_partners" ? (
        <label className="gw-check">
          <input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} />
          <span>{t("notifyRouting.includeOwner")}</span>
        </label>
      ) : null}
      <div className="gw-route__actions">
        {area.configured ? (
          <button type="button" className="gw-linkbtn" onClick={() => onSave({ area: area.area, reset: true })} disabled={saving}>
            <RotateCcw size={12} aria-hidden /> {t("notifyRouting.reset")}
          </button>
        ) : null}
        <BusyButton tone="gold" label={t("pf.save")} busy={saving} disabled={!ids.length || !dirty} onClick={() => onSave({ area: area.area, admin_ids: ids, include_owner: owner })} />
      </div>
    </article>
  );
}
