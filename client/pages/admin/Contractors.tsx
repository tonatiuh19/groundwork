import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Send, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  fetchAdminContractors,
  inviteContractor,
  updateAdminContractor,
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
  StatusBadge,
  SubmitButton,
  TextField,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

const STATUSES = ["active", "inactive", "suspended"] as const;
const FILTER_STATUSES = ["invited", ...STATUSES] as const;
const PAGE_SIZE = 50;

export default function AdminContractors() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { items, total, loading, error } = useAppSelector((s) => s.adminPortal.contractors);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const canInvite = useAdminCan("approvals");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const rowBusy = useRowBusy();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";

  useEffect(() => {
    setOffset(0);
  }, [q, status]);

  const load = () =>
    void dispatch(
      fetchAdminContractors({
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
        titleKey="portalNav.contractors"
        leadKey="admin.contractorsLead"
        actions={
          canInvite ? (
            <HeaderAction
              labelKey="admin.inviteContractor"
              icon={UserPlus}
              onClick={() => {
                dispatch(clearAdminSaveError());
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
          options={enumOptions(t, "accountStatus", FILTER_STATUSES)}
        />
      </div>
      <ErrorNote error={error} />
      {!open ? <ErrorNote error={saveError} /> : null}
      <DataTable
        rows={items}
        loading={loading}
        emptyKey="admin.noContractors"
        rowKey={(c) => c.id}
        onRowClick={(c) => navigate(`/admin/contractors/${c.id}`)}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (c) => (
              <>
                <strong>{c.first_name} {c.last_name}</strong>
                <br />
                <span className="pf-muted">{c.email}</span>
              </>
            ),
          },
          { key: "company", headerKey: "pf.company", render: (c) => c.company || "—" },
          { key: "license", headerKey: "admin.license", render: (c) => c.license_number || "—" },
          { key: "projects", headerKey: "portalNav.projects", render: (c) => c.project_count },
          { key: "date", headerKey: "pf.created", render: (c) => fmt.date(c.created_at) },
          {
            key: "status",
            headerKey: "pf.status",
            render: (c) =>
              c.status === "invited" || !canInvite ? (
                <StatusBadge group="accountStatus" value={c.status} />
              ) : (
                <InlineSelect
                  ariaLabel={t("pf.status")}
                  value={c.status}
                  disabled={rowBusy.isRowLocked(c.id)}
                  options={enumOptions(t, "accountStatus", STATUSES)}
                  onChange={(v) => {
                    void rowBusy.run(
                      c.id,
                      "status",
                      async () => {
                        const r = await dispatch(
                          updateAdminContractor({ id: c.id, patch: { status: v } }),
                        );
                        return updateAdminContractor.fulfilled.match(r);
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
              c.status === "invited" && canInvite ? (
                <BusyButton
                  icon={Send}
                  stopPropagation
                  label={t("admin.resendInvite")}
                  busyLabel={t("pf.busy.sendingInvite")}
                  doneLabel={t("pf.done.inviteSent")}
                  busy={rowBusy.isBusy(c.id, "invite")}
                  done={rowBusy.isDone(c.id, "invite")}
                  disabled={rowBusy.isRowLocked(c.id) && !rowBusy.isBusy(c.id, "invite") && !rowBusy.isDone(c.id, "invite")}
                  onClick={() => {
                    void rowBusy.run(
                      c.id,
                      "invite",
                      async () => {
                        const r = await dispatch(
                          inviteContractor({
                            email: c.email,
                            first_name: c.first_name,
                            last_name: c.last_name,
                            company: c.company,
                            license_number: c.license_number,
                            phone: c.phone,
                            preferred_language: lang,
                          }),
                        );
                        return inviteContractor.fulfilled.match(r);
                      },
                      { flash: true, onFlashEnd: load },
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

      <Modal open={open} titleKey="admin.inviteContractor" onClose={() => setOpen(false)}>
        <Formik
          initialValues={{ first_name: "", last_name: "", email: "", company: "", license_number: "", phone: "" }}
          validationSchema={schema}
          onSubmit={async (v) => {
            const r = await dispatch(
              inviteContractor({
                ...v,
                email: v.email.trim(),
                first_name: v.first_name.trim(),
                last_name: v.last_name.trim(),
                company: v.company.trim() || null,
                license_number: v.license_number.trim() || null,
                phone: v.phone.trim() || null,
                preferred_language: lang,
              }),
            );
            if (inviteContractor.fulfilled.match(r)) {
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
            </div>
            <TextField name="email" labelKey="form.email" type="email" />
            <div className="pf-form-grid">
              <TextField name="company" labelKey="pf.company" />
              <TextField name="license_number" labelKey="admin.license" />
            </div>
            <TextField name="phone" labelKey="form.phone" type="tel" />
            <SubmitButton busy={saving} labelKey="admin.sendInvite" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
