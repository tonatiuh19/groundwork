import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, MapPin, Send, Trash2, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CityPartnerFee, CityPartnerListItem } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { clearCityError, clearInvitePreview, createCityPartner, deleteCityPartner, fetchAllCityFees, fetchCityPartners, resendCityPartnerInvite, previewCityInvite, updateCityFee, updateCityPartner } from "@/store/slices/cityPartnerSlice";
import { fetchAdminCities } from "@/store/slices/citiesSlice";
import { BusyButton, DataTable, ErrorNote, FilterSelect, HeaderAction, ListPager, Modal, PageHeader, SearchBox, SegmentedTabs } from "@/components/portal/kit";
import { MultiSearchPicker } from "@/components/portal/SearchPickers";
import DangerConfirmModal from "@/components/portal/DangerConfirmModal";
import EmailPreviewModal from "@/components/portal/EmailPreviewModal";
import CityCreateModal from "@/components/admin/CityCreateModal";
import { centsToMoney } from "@/components/city/CityBits";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";

const PAGE = 25;
const FEE_NEXT: Record<string, string[]> = { pending: ["approved", "void"], approved: ["paid", "void"], paid: ["refund_due"], refund_due: ["refunded"], void: ["pending"], refunded: [] };
const partnerName = (p: { company: string | null; first_name: string; last_name: string }) => p.company || `${p.first_name} ${p.last_name}`.trim();
const stepOf = (p: CityPartnerListItem) => (!p.agreement ? "invited" : !p.agreement.countersigned_at ? "countersign" : !p.w9 || p.w9.status === "rejected" ? "w9" : p.w9.status === "submitted" ? "w9_review" : "ready");

function PartnersGrid() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { partners, partnersTotal, loading, saving, error } = useAppSelector((s) => s.cityPartner);
  const cities = useAppSelector((s) => s.cities.adminList);
  const canManage = useAdminCan("approvals");
  const isSuper = useAppSelector((s) => s.portalAuth.admin.user?.role === "super_admin");
  const [f, setF] = useState({ q: "", status: "", agreement: "", w9: "", city_id: "" });
  const [offset, setOffset] = useState(0);
  const [toDelete, setToDelete] = useState<CityPartnerListItem | null>(null);
  const load = () => void dispatch(fetchCityPartners({ ...f, limit: PAGE, offset }));
  useEffect(load, [dispatch, f, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (v: string) => {
    setOffset(0);
    setF({ ...f, [k]: v });
  };
  return (
    <>
      <div className="pf-filters">
        <SearchBox onSearch={set("q")} />
        <FilterSelect value={f.status} onChange={set("status")} ariaLabel={t("pf.status")} allLabel={t("cityPartner.filterAllStatuses")} options={[{ value: "active", label: t("cityPartner.active") }, { value: "inactive", label: t("cityPartner.inactive") }]} />
        <FilterSelect value={f.agreement} onChange={set("agreement")} ariaLabel={t("cityPartner.agreement")} allLabel={t("cityPartner.filterAnyAgreement")} options={(["none", "signed", "countersigned"] as const).map((v) => ({ value: v, label: t(`cityPartner.agreementState.${v}`) }))} />
        <FilterSelect value={f.w9} onChange={set("w9")} ariaLabel="W-9" allLabel={t("cityPartner.filterAnyW9")} options={(["missing", "submitted", "accepted", "rejected"] as const).map((v) => ({ value: v, label: v === "missing" ? t("cityPartner.noW9Short") : t(`cityPartner.w9Status.${v}`) }))} />
        <FilterSelect value={f.city_id} onChange={set("city_id")} ariaLabel={t("cityPartner.cities")} allLabel={t("cities.filterAll")} options={cities.map((c) => ({ value: c.id, label: c.name }))} />
      </div>
      <ErrorNote error={error} />
      <DataTable<CityPartnerListItem>
        rows={partners}
        loading={loading}
        skeleton
        rowKey={(p) => p.id}
        emptyKey="cityPartner.noPartners"
        onRowClick={(p) => navigate(`/admin/city-partners/${p.id}`)}
        columns={[
          { key: "name", headerKey: "cityPartner.colPartner", render: (p) => (<span><strong>{partnerName(p)}</strong><br /><small className="pf-muted">{p.first_name} {p.last_name} · {p.email}</small></span>) },
          { key: "cities", headerKey: "cityPartner.cities", render: (p) => (p.cities.length ? p.cities.map((c) => c.name).join(", ") : t("cityPartner.noCities")) },
          { key: "rate", headerKey: "cityPartner.colRate", render: (p) => centsToMoney(p.fee_cents_per_sqft) },
          { key: "step", headerKey: "cityPartner.colStep", render: (p) => (<span className={`gw-city-badge is-${stepOf(p) === "ready" ? "opened" : "upcoming"}`}>{t(`cityPartner.partnerStatus.${stepOf(p)}`)}</span>) },
          { key: "status", headerKey: "pf.status", render: (p) => (p.status === "active" ? t("cityPartner.active") : <span className="gw-city-badge is-overdue">{t("cityPartner.inactive")}</span>) },
          {
            key: "actions",
            headerKey: "cityPartner.colActions",
            render: (p) => (
              <span className="pf-table-actions" onClick={(e) => e.stopPropagation()}>
                <Link className="pf-btn pf-btn--sm" to={`/admin/city-partners/${p.id}`}>{t("cityPartner.open")}</Link>
                {canManage && p.status === "active" ? <BusyButton icon={Send} label={t("cityPartner.resendShort")} busy={saving} onClick={() => void dispatch(resendCityPartnerInvite(p.id))} /> : null}
                {canManage ? <BusyButton label={t(p.status === "active" ? "cityPartner.deactivateShort" : "cityPartner.activate")} busy={saving} onClick={async () => { await dispatch(updateCityPartner({ id: p.id, body: { status: p.status === "active" ? "inactive" : "active" } })); load(); }} /> : null}
                {isSuper ? (
                  <button type="button" className="pf-icon-btn" aria-label={t("cityPartner.deletePartner", { name: partnerName(p) })} onClick={() => { dispatch(clearCityError()); setToDelete(p); }}>
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      <ListPager total={partnersTotal} limit={PAGE} offset={offset} onPageChange={setOffset} loading={loading} />
      <DangerConfirmModal
        open={Boolean(toDelete)}
        titleKey="cityPartner.deleteTitle"
        confirmText={toDelete ? partnerName(toDelete) : undefined}
        confirmLabel={t("cityPartner.deleteForever")}
        busy={saving}
        error={error}
        onCancel={() => setToDelete(null)}
        onConfirm={async (typed) => {
          if (!toDelete) return;
          const r = await dispatch(deleteCityPartner({ id: toDelete.id, confirm_name: typed }));
          if (deleteCityPartner.fulfilled.match(r)) {
            setToDelete(null);
            load();
          }
        }}
      >
        <p>
          <strong>{t("cityPartner.deleteWarn", { name: toDelete ? partnerName(toDelete) : "" })}</strong>
        </p>
        <ul>
          <li>{t("cityPartner.deleteLoses1")}</li>
          <li>{t("cityPartner.deleteLoses2")}</li>
          <li>{t("cityPartner.deleteLoses3")}</li>
        </ul>
        <p className="pf-hint">{t("cityPartner.deleteAlternative")}</p>
      </DangerConfirmModal>
    </>
  );
}

function FeesGrid() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { allFees, feesTotal, feeTotals, loading, saving, error } = useAppSelector((s) => s.cityPartner);
  const cities = useAppSelector((s) => s.cities.adminList);
  const canPay = useAdminCan("finance.write");
  const [f, setF] = useState({ status: "open", city_id: "", due_from: "", due_to: "" });
  const [offset, setOffset] = useState(0);
  const load = () => void dispatch(fetchAllCityFees({ ...f, limit: PAGE, offset }));
  useEffect(load, [dispatch, f, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (v: string) => {
    setOffset(0);
    setF({ ...f, [k]: v });
  };
  return (
    <>
      <div className="gw-city-totals">
        {feeTotals.map((x) => (
          <span key={x.status} className="gw-city-badge is-upcoming">
            {t(`cityPartner.feeStatus.${x.status}`)}: {x.count} · {centsToMoney(x.amount_cents)}
          </span>
        ))}
      </div>
      <div className="pf-filters">
        <FilterSelect value={f.status} onChange={set("status")} ariaLabel={t("pf.status")} allLabel={t("cityPartner.filterAllFees")} options={[{ value: "open", label: t("cityPartner.feesOpen") }, ...(["pending", "approved", "paid", "void", "refund_due", "refunded"] as const).map((v) => ({ value: v, label: t(`cityPartner.feeStatus.${v}`) }))]} />
        <FilterSelect value={f.city_id} onChange={set("city_id")} ariaLabel={t("cityPartner.cities")} allLabel={t("cities.filterAll")} options={cities.map((c) => ({ value: c.id, label: c.name }))} />
        <label className="gw-city-date">
          <span>{t("cityPartner.dueFrom")}</span>
          <input type="date" value={f.due_from} onChange={(e) => set("due_from")(e.target.value)} />
        </label>
        <label className="gw-city-date">
          <span>{t("cityPartner.dueTo")}</span>
          <input type="date" value={f.due_to} onChange={(e) => set("due_to")(e.target.value)} />
        </label>
      </div>
      <ErrorNote error={error} />
      <DataTable<CityPartnerFee>
        rows={allFees}
        loading={loading}
        skeleton
        rowKey={(x) => x.id}
        emptyKey="cityPartner.noFees"
        columns={[
          { key: "partner", headerKey: "cityPartner.colPartner", render: (x) => <Link className="text-link" to={`/admin/city-partners/${x.city_partner_id}`}>{x.partner_name}</Link> },
          { key: "project", headerKey: "cityPartner.colProject", render: (x) => (<span>{x.project_public_id}<br /><small className="pf-muted">{x.city_name}</small></span>) },
          { key: "amount", headerKey: "cityPartner.colAmount", render: (x) => (<span><strong>{centsToMoney(x.amount_cents)}</strong><br /><small className="pf-muted">{x.sq_ft} sq ft × {centsToMoney(x.rate_cents_per_sqft)}</small></span>) },
          { key: "due", headerKey: "cityPartner.colDue", render: (x) => fmt.date(`${x.due_on}T12:00:00`) },
          { key: "status", headerKey: "pf.status", render: (x) => t(`cityPartner.feeStatus.${x.status}`) },
          {
            key: "actions",
            headerKey: "cityPartner.colActions",
            render: (x) =>
              canPay ? (
                <span className="pf-table-actions">
                  {(FEE_NEXT[x.status] || []).map((n) => (
                    <BusyButton key={n} tone={n === "paid" ? "gold" : "default"} label={t(`cityPartner.feeAction.${n}`)} busy={saving} onClick={async () => { await dispatch(updateCityFee({ id: x.id, status: n })); load(); }} />
                  ))}
                </span>
              ) : null,
          },
        ]}
      />
      <ListPager total={feesTotal} limit={PAGE} offset={offset} onPageChange={setOffset} loading={loading} />
    </>
  );
}

/** Admin → City Partners: partners and their fees as server-side grids. Invite-only. */
export default function CityPartners() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { saving, error } = useAppSelector((s) => s.cityPartner);
  const cities = useAppSelector((s) => s.cities.adminList);
  const canManage = useAdminCan("approvals");
  const canSeeFees = useAdminCan("finance.read");
  const [tab, setTab] = useState<"partners" | "fees">("partners");
  const blank = { first_name: "", last_name: "", email: "", phone: "", company: "", preferred_language: "en", fee: "2.00", city_ids: [] as number[] };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [quickAdd, setQuickAdd] = useState<string | null>(null);
  const { invitePreview, previewing } = useAppSelector((s) => s.cityPartner);
  useEffect(() => {
    void dispatch(fetchAdminCities());
  }, [dispatch]);
  const inviteReady = Boolean(f.first_name.trim() && f.email.trim() && f.company.trim() && /^\d+(\.\d{1,2})?$/.test(f.fee.trim()));
  const draft = { ...f, fee_cents_per_sqft: Math.round(Number(f.fee) * 100), fee: undefined };
  const sendButton = (
    <BusyButton
      tone="gold"
      icon={UserPlus}
      label={t("cityPartner.sendInvite")}
      busy={saving}
      disabled={!inviteReady}
      onClick={async () => {
        const r = await dispatch(createCityPartner(draft));
        if (createCityPartner.fulfilled.match(r)) {
          dispatch(clearInvitePreview());
          navigate(`/admin/city-partners/${r.payload.id}`);
        }
      }}
    />
  );

  return (
    <div className="portal-page">
      <PageHeader titleKey="cityPartner.adminTitle" leadKey="cityPartner.adminLead" actions={canManage ? <HeaderAction labelKey="cityPartner.invite" icon={UserPlus} onClick={() => setOpen(true)} /> : null} />
      {canSeeFees ? (
        <SegmentedTabs<"partners" | "fees">
          value={tab}
          onChange={setTab}
          ariaLabel={t("cityPartner.adminTitle")}
          options={[
            { value: "partners", labelKey: "cityPartner.tabPartners" },
            { value: "fees", labelKey: "cityPartner.fees" },
          ]}
        />
      ) : null}
      {tab === "partners" ? <PartnersGrid /> : <FeesGrid />}
      <Modal open={open} titleKey="cityPartner.invite" onClose={() => { setOpen(false); setF(blank); dispatch(clearCityError()); }}>
        <div className="pf-form">
          <div className="pf-form-grid">
            {(["first_name", "last_name"] as const).map((k) => (
              <label key={k} className="pf-field">
                <span>{t(`form.${k === "first_name" ? "firstName" : "lastName"}`)}{k === "first_name" ? " *" : ""}</span>
                <input value={f[k]} maxLength={100} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <label className="pf-field">
            <span>{t("form.email")} *</span>
            <input type="email" value={f.email} maxLength={255} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          <label className="pf-field">
            <span>{t("cityPartner.company")} *</span>
            <input value={f.company} maxLength={200} placeholder={t("cityPartner.companyPh")} onChange={(e) => setF({ ...f, company: e.target.value })} />
          </label>
          <label className="pf-field">
            <span>{t("form.phone")}</span>
            <input type="tel" value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </label>
          <div className="pf-form-grid">
            <label className="pf-field">
              <span>{t("cityPartner.rate")}</span>
              <input inputMode="decimal" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} />
            </label>
            <label className="pf-field">
              <span>{t("cityPartner.language")}</span>
              <select value={f.preferred_language} onChange={(e) => setF({ ...f, preferred_language: e.target.value })}>
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </label>
          </div>
          <p className="pf-hint">{t("cityPartner.rateHint")}</p>
          <MultiSearchPicker
            icon={MapPin}
            label={t("cityPartner.cities")}
            items={cities.map((c) => ({ id: c.id, label: c.name }))}
            selected={f.city_ids}
            empty={t("cities.none")}
            onToggle={(id) => setF({ ...f, city_ids: f.city_ids.includes(id) ? f.city_ids.filter((x) => x !== id) : [...f.city_ids, id] })}
            onCreate={(q) => setQuickAdd(q)}
            createLabel={(q) => (q ? t("cities.addNamed", { name: q }) : t("cities.add"))}
            manageHref="/admin/settings#cities"
            manageLabel={t("cities.manage")}
          />
          <ErrorNote error={error} />
          <div className="pf-actions">
            <BusyButton icon={Eye} label={t("cityPartner.previewInvite")} busy={previewing} disabled={!inviteReady} onClick={() => void dispatch(previewCityInvite({ ...draft, email: undefined }))} />
            {sendButton}
          </div>
        </div>
      </Modal>
      <EmailPreviewModal preview={open ? invitePreview : null} onClose={() => dispatch(clearInvitePreview())} footer={sendButton} />
      <CityCreateModal initialName={quickAdd} onClose={() => setQuickAdd(null)} onPicked={(id) => setF((cur) => ({ ...cur, city_ids: cur.city_ids.includes(id) ? cur.city_ids : [...cur.city_ids, id] }))} />
    </div>
  );
}
