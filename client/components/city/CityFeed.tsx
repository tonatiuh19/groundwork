import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Banknote, CalendarCheck, FileSignature, Flag, Home, Mail, MapPinned, MessageSquare, Phone, PartyPopper, Plus, Presentation, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CityFeedItem, CityPipelineCity } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addCityActivity } from "@/store/slices/cityPartnerSlice";
import { ActivityFeed, KitEmpty, type FeedEntry } from "@/components/partnerKit/PartnerKit";
import { BusyButton, ErrorNote } from "@/components/portal/kit";
import { Modal } from "@/components/portal/Modal";
import { ACTIVITY_TYPES, centsToMoney } from "@/components/city/CityBits";
import { useFormatters } from "@/lib/format";

const ACT_ICON: Record<string, FeedEntry["icon"]> = { call: Phone, email: Mail, meeting: CalendarCheck, presentation: Presentation, follow_up: MessageSquare, plan_submission: Send, other: MessageSquare };

/** City Partner feed: activities, stage moves, Opened City moments, homeowner progress, fees, agreement. */
export function CityFeed({ items }: { items: CityFeedItem[] }) {
  const { t } = useTranslation();
  const fmt = useFormatters();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const entries: FeedEntry[] = items.map((it, i) => {
    const to = it.city_id ? `/city/cities/${it.city_id}` : it.kind.startsWith("fee") ? "/city/fees" : "/city/agreement";
    const time = fmt.relative(it.at);
    const city = it.city ? ` · ${it.city}` : "";
    if (it.kind.startsWith("activity_")) {
      const type = it.kind.slice(9);
      return { id: `${i}`, icon: ACT_ICON[type] || MessageSquare, tone: "ink", title: `${t(`cityPartner.activityType.${type}`)}${city}`, detail: it.detail, meta: `${it.title ? `${it.title} · ` : ""}${time}`, at: it.at, to };
    }
    if (it.kind === "city_opened") return { id: `${i}`, icon: PartyPopper, tone: "green", title: t("cityPartner.feed.opened", { city: it.city }), meta: time, at: it.at, to };
    if (it.kind === "stage") return { id: `${i}`, icon: Flag, tone: "gold", title: t("cityPartner.feed.stage", { city: it.city, stage: t(`cityPartner.stage.${it.title}`) }), meta: time, at: it.at, to };
    if (it.kind === "homeowner") return { id: `${i}`, icon: Home, tone: "clay", title: t("cityPartner.feed.homeowner", { name: it.title, stage: t(`milestone.${it.detail}`) }), meta: `${it.city} · ${time}`, at: it.at, to: "/city/clients" };
    if (it.kind === "fee_earned") return { id: `${i}`, icon: Banknote, tone: "gold", title: t("cityPartner.feed.feeEarned", { amount: centsToMoney(it.amount_cents || 0) }), meta: `${it.city} · ${time}`, at: it.at, to };
    if (it.kind === "fee_paid") return { id: `${i}`, icon: BadgeCheck, tone: "green", title: t("cityPartner.feed.feePaid", { amount: centsToMoney(it.amount_cents || 0) }), meta: `${it.city} · ${time}`, at: it.at, to };
    if (it.kind === "countersigned") return { id: `${i}`, icon: BadgeCheck, tone: "green", title: t("cityPartner.feed.countersigned"), meta: time, at: it.at, to };
    return { id: `${i}`, icon: FileSignature, tone: "ink", title: t("cityPartner.feed.signed"), meta: time, at: it.at, to };
  });
  return (
    <ActivityFeed
      items={entries}
      dayLabel={(d) => (d === today ? t("cityPartner.feed.today") : d === yesterday ? t("cityPartner.feed.yesterday") : fmt.date(`${d}T12:00:00`))}
      renderLink={(to, children) => <Link to={to}>{children}</Link>}
      empty={<KitEmpty icon={MapPinned} title={t("cityPartner.feed.emptyTitle")} text={t("cityPartner.feed.emptyText")} />}
    />
  );
}

/** One tap to log a call or meeting from anywhere in the portal. */
export function QuickLog({ cities, onLogged }: { cities: CityPipelineCity[]; onLogged: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { saving, error } = useAppSelector((s) => s.cityPartner);
  const [open, setOpen] = useState(false);
  const blank = { city: "", activity_type: "call", contact_name: "", summary: "", next_step: "", follow_up_on: "" };
  const [f, setF] = useState(blank);
  const on = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const city = f.city || (cities.length === 1 ? String(cities[0].id) : "");
  return (
    <>
      <button type="button" className="pf-btn pf-btn--gold" onClick={() => setOpen(true)} disabled={!cities.length}>
        <Plus size={16} aria-hidden /> {t("cityPartner.quickLog")}
      </button>
      <Modal open={open} titleKey="cityPartner.quickLog" onClose={() => setOpen(false)}>
        <div className="pf-form">
          <div className="pf-form-grid">
            <label className="pf-field">
              <span>{t("cityPartner.cityLabel")}</span>
              <select value={city} onChange={on("city")}>
                <option value="">{t("cities.choose")}</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="pf-field">
              <span>{t("cityPartner.activity.type")}</span>
              <select value={f.activity_type} onChange={on("activity_type")}>
                {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{t(`cityPartner.activityType.${a}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="pf-field">
            <span>{t("cityPartner.activity.contact")}</span>
            <input value={f.contact_name} maxLength={160} onChange={on("contact_name")} />
          </label>
          <label className="pf-field">
            <span>{t("cityPartner.activity.summary")}</span>
            <textarea rows={3} maxLength={1000} value={f.summary} onChange={on("summary")} />
          </label>
          <div className="pf-form-grid">
            <label className="pf-field">
              <span>{t("cityPartner.activity.nextStep")}</span>
              <input value={f.next_step} maxLength={300} onChange={on("next_step")} />
            </label>
            <label className="pf-field">
              <span>{t("cityPartner.activity.followUp")}</span>
              <input type="date" value={f.follow_up_on} onChange={on("follow_up_on")} />
            </label>
          </div>
          <ErrorNote error={error} />
          <div className="pf-actions">
            <BusyButton
              tone="gold"
              label={t("cityPartner.activity.add")}
              busy={saving}
              disabled={!city || !f.summary.trim()}
              onClick={async () => {
                const { city: _c, ...body } = f;
                const r = await dispatch(addCityActivity({ scope: "city", id: Number(city), body }));
                if (addCityActivity.fulfilled.match(r)) {
                  setOpen(false);
                  setF(blank);
                  onLogged();
                }
              }}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
