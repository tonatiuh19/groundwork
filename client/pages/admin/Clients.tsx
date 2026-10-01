import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Mail, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  createAdminClient,
  fetchAdminAffiliates,
  fetchAdminClients,
  sendClientPortalInvite,
  updateAdminClient,
} from "@/store/slices/adminPortalSlice";
import {
  BusyButton,
  DataTable,
  ErrorNote,
  FilterSelect,
  HeaderAction,
  InlineSelect,
  ListPager,
  Modal,
  PageHeader,
  SearchBox,
  SelectField,
  SubmitButton,
  TextField,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const STATUSES = ["prospect", "active", "inactive", "suspended"] as const;
const PAGE_SIZE = 50;

export default function AdminClients() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.clients);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const affiliates = useAppSelector((s) => s.adminPortal.affiliates.items);
  const canWrite = useAdminCan("people.write");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [invited, setInvited] = useState<number | null>(null);
  const rowBusy = useRowBusy();

  useEffect(() => {
    setOffset(0);
  }, [q, status]);

  const load = () =>
    void dispatch(
      fetchAdminClients({
        q: q || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    );
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, [q, status, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
  });

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="portalNav.clients"
        leadKey="admin.clientsLead"
        actions={
          canWrite ? (
            <HeaderAction
              labelKey="admin.addClient"
              icon={UserPlus}
              onClick={() => {
                dispatch(clearAdminSaveError());
                void dispatch(fetchAdminAffiliates({ status: "active", limit: 100 }));
                setOpen(true);
              }}
            />
          ) : null
        }
      />
      <div className="pf-filters">
        <SearchBox onSearch={setQ} />
        <FilterSelect
          value={status}
          onChange={setStatus}
          ariaLabel={t("pf.status")}
          allLabel={t("admin.filterAllStatuses")}
          options={enumOptions(t, "accountStatus", STATUSES)}
        />
      </div>
      <ErrorNote error={error} />
      {!open ? <ErrorNote error={saveError} /> : null}
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noClients"
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/admin/clients/${c.id}`)}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (c) => (
              <>
                <strong>{c.first_name} {c.last_name}</strong>
                <br />
                <span className="pf-muted">{c.email}{c.phone ? ` · ${c.phone}` : ""}</span>
              </>
            ),
          },
          { key: "address", headerKey: "pf.address", render: (c) => [c.address_line1, c.city].filter(Boolean).join(", ") || "—" },
          { key: "aff", headerKey: "admin.affiliate", render: (c) => c.affiliate_name || "—" },
          { key: "projects", headerKey: "portalNav.projects", render: (c) => c.project_count },
          { key: "date", headerKey: "pf.created", render: (c) => fmt.date(c.created_at) },
          {
            key: "status",
            headerKey: "pf.status",
            render: (c) => (
              <InlineSelect
                ariaLabel={t("pf.status")}
                value={c.status}
                disabled={!canWrite || rowBusy.isRowLocked(c.id)}
                options={enumOptions(t, "accountStatus", STATUSES)}
                onChange={(v) => {
                  void rowBusy.run(
                    c.id,
                    "status",
                    async () => {
                      const r = await dispatch(updateAdminClient({ id: c.id, patch: { status: v } }));
                      return updateAdminClient.fulfilled.match(r);
                    },
                    { onFlashEnd: load },
                  );
                }}
              />
            ),
          },
          {
            key: "actions",
            headerKey: "pf.actions",
            render: (c) =>
              canWrite ? (
                <BusyButton
                  icon={Mail}
                  stopPropagation
                  label={
                    invited === c.id || rowBusy.isDone(c.id, "invite")
                      ? t("admin.inviteSent")
                      : t("admin.portalInvite")
                  }
                  busyLabel={t("pf.busy.sendingPortalInvite")}
                  doneLabel={t("pf.done.inviteSent")}
                  busy={rowBusy.isBusy(c.id, "invite")}
                  done={rowBusy.isDone(c.id, "invite")}
                  disabled={rowBusy.isRowLocked(c.id) && !rowBusy.isBusy(c.id, "invite") && !rowBusy.isDone(c.id, "invite")}
                  onClick={() => {
                    void rowBusy.run(
                      c.id,
                      "invite",
                      async () => {
                        const r = await dispatch(sendClientPortalInvite(c.id));
                        return sendClientPortalInvite.fulfilled.match(r);
                      },
                      {
                        flash: true,
                        onFlashEnd: () => setInvited(c.id),
                      },
                    );
                  }}
                />
              ) : null,
          },
        ]}
      />
      <ListPager
        total={total}
        limit={PAGE_SIZE}
        offset={offset}
        loading={loading}
        onPageChange={setOffset}
      />

      <Modal open={open} titleKey="admin.addClient" onClose={() => setOpen(false)}>
        <Formik
          initialValues={{ first_name: "", last_name: "", email: "", phone: "", address_line1: "", city: "", zip: "", affiliate_id: "" }}
          validationSchema={schema}
          onSubmit={async (v) => {
            const { affiliate_id, ...rest } = v;
            const r = await dispatch(
              createAdminClient({
                ...rest,
                affiliate_id: affiliate_id ? Number(affiliate_id) : null,
                preferred_language: i18n.language?.startsWith("es") ? "es" : "en",
              }),
            );
            if (createAdminClient.fulfilled.match(r)) {
              setOpen(false);
              load();
            }
          }}
        >
          <Form className="pf-form">
            <ErrorNote error={saveError} />
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
              <TextField name="email" labelKey="form.email" type="email" />
              <TextField name="phone" labelKey="form.phone" type="tel" />
            </div>
            <TextField name="address_line1" labelKey="form.address" />
            <div className="pf-form-grid">
              <TextField name="city" labelKey="pf.city" />
              <TextField name="zip" labelKey="pf.zip" />
            </div>
            <SelectField
              name="affiliate_id"
              labelKey="admin.affiliate"
              options={[
                { value: "", label: t("pf.none") },
                ...affiliates
                  .filter((a) => a.status === "active")
                  .map((a) => ({ value: a.id, label: `${a.first_name} ${a.last_name}` })),
              ]}
            />
            <SubmitButton busy={saving} labelKey="pf.create" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
