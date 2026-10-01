import { useEffect, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  createStaff,
  fetchAdminStaff,
  updateStaff,
} from "@/store/slices/adminPortalSlice";
import {
  DataTable,
  ErrorNote,
  HeaderAction,
  InlineSelect,
  Modal,
  PageHeader,
  SelectField,
  SubmitButton,
  TextField,
  enumOptions,
  useRowBusy,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

const ROLES = ["super_admin", "admin", "agent", "finance", "content"] as const;
const STATUSES = ["active", "inactive", "suspended"] as const;

export default function AdminStaff() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { items, loading, error } = useAppSelector((s) => s.adminPortal.staff);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const me = useAppSelector((s) => s.portalAuth.admin.user);
  const [open, setOpen] = useState(false);
  const rowBusy = useRowBusy();

  const load = () => void dispatch(fetchAdminStaff());
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
  });

  const patch = (id: number, p: Record<string, string>) => {
    void rowBusy.run(
      id,
      "status",
      async () => {
        const r = await dispatch(updateStaff({ id, patch: p }));
        return updateStaff.fulfilled.match(r);
      },
      { onFlashEnd: load },
    );
  };

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="portalNav.staff"
        leadKey="admin.staffLead"
        actions={
          <HeaderAction
            labelKey="admin.addStaff"
            icon={UserPlus}
            onClick={() => {
              dispatch(clearAdminSaveError());
              setOpen(true);
            }}
          />
        }
      />
      <ErrorNote error={error} />
      {!open ? <ErrorNote error={saveError} /> : null}
      <DataTable
        rows={items}
        loading={loading}
        rowKey={(s) => s.id}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (s) => (
              <>
                <strong>{s.first_name} {s.last_name}</strong>
                {s.id === me?.id ? <span className="pf-badge pf-badge--muted">{t("admin.you")}</span> : null}
                <br />
                <span className="pf-muted">{s.email}</span>
              </>
            ),
          },
          {
            key: "role",
            headerKey: "admin.role",
            render: (s) => (
              <InlineSelect
                ariaLabel={t("admin.role")}
                value={s.role}
                disabled={rowBusy.isRowLocked(s.id)}
                options={enumOptions(t, "role", ROLES)}
                onChange={(v) => patch(s.id, { role: v })}
              />
            ),
          },
          {
            key: "status",
            headerKey: "pf.status",
            render: (s) => (
              <InlineSelect
                ariaLabel={t("pf.status")}
                value={s.status}
                disabled={rowBusy.isRowLocked(s.id)}
                options={enumOptions(t, "accountStatus", STATUSES)}
                onChange={(v) => patch(s.id, { status: v })}
              />
            ),
          },
          { key: "login", headerKey: "admin.lastLogin", render: (s) => fmt.date(s.last_login_at) },
        ]}
      />

      <Modal open={open} titleKey="admin.addStaff" onClose={() => setOpen(false)}>
        <Formik
          initialValues={{ first_name: "", last_name: "", email: "", role: "agent" }}
          validationSchema={schema}
          onSubmit={async (v) => {
            const r = await dispatch(
              createStaff({ ...v, preferred_language: i18n.language?.startsWith("es") ? "es" : "en" }),
            );
            if (createStaff.fulfilled.match(r)) {
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
            <SelectField name="role" labelKey="admin.role" options={enumOptions(t, "role", ROLES)} />
            <p className="pf-muted">{t("admin.roleHelp")}</p>
            <SubmitButton busy={saving} labelKey="pf.create" />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
