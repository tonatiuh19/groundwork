import { useEffect, useState, useRef } from "react";
import { touchColumns } from "@/components/admin/leads/LeadTouchCell";
import { Link, useNavigate } from "react-router-dom";
import PersonConflictNotice from "@/components/portal/PersonConflictNotice";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { BookUser, MessageSquare, Phone, Plus, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CrmContact } from "@shared/api";
import {
  DataTable,
  ErrorNote,
  HeaderAction,
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
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearContactsMutateError,
  convertAdminContact,
  createAdminContact,
  deleteAdminContact,
  fetchAdminContacts,
  updateAdminContact,
} from "@/store/slices/contactsSlice";

const PAGE_SIZE = 50;

type FormValues = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line1: string;
  city: string;
  state: string;
  zip: string;
  preferred_language: "en" | "es";
  admin_notes: string;
};

const emptyForm = (): FormValues => ({
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  address_line1: "",
  city: "",
  state: "",
  zip: "",
  preferred_language: "en",
  admin_notes: "",
});

function toForm(c: CrmContact): FormValues {
  return {
    first_name: c.first_name || "",
    last_name: c.last_name || "",
    email: c.email || "",
    phone: c.phone || "",
    address_line1: c.address_line1 || "",
    city: c.city || "",
    state: c.state || "",
    zip: c.zip || "",
    preferred_language: c.preferred_language || "en",
    admin_notes: c.admin_notes || "",
  };
}

export default function AdminContacts() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const lastConvertId = useRef<number | null>(null);
  const fmt = useFormatters();
  const canWrite = useAdminCan("people.write");
  const {
    contacts,
    pagination,
    loading,
    error,
    mutating,
    mutateError,
  } = useAppSelector((s) => s.contacts);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CrmContact | null>(null);
  const rowBusy = useRowBusy();

  const page = Math.floor(offset / PAGE_SIZE) + 1;

  const load = () =>
    void dispatch(
      fetchAdminContacts({
        search: q || undefined,
        page,
        limit: PAGE_SIZE,
      }),
    );

  useEffect(() => {
    setOffset(0);
  }, [q]);

  useEffect(() => {
    dispatch(clearContactsMutateError());
    load();
  }, [q, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .test("email-or-phone", t("contacts.emailOrPhone"), function (v) {
        const phone = String(this.parent.phone || "").trim();
        return Boolean((v && v.trim()) || phone);
      }),
    phone: Yup.string()
      .trim()
      .test("phone", t("validation.phoneMin"), (v) => {
        if (!v) return true;
        return v.replace(/\D/g, "").length >= 10;
      }),
  });

  const total = pagination?.total ?? contacts.length;

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="portalNav.contacts"
        leadKey="contacts.lead"
        actions={
          canWrite ? (
            <HeaderAction
              labelKey="contacts.add"
              icon={Plus}
              onClick={() => {
                dispatch(clearContactsMutateError());
                setEditing(null);
                setOpen(true);
              }}
            />
          ) : null
        }
      />
      <ErrorNote error={error} />
      {!open ? <ErrorNote error={mutateError} /> : null}
      <PersonConflictNotice
        onOverride={async (reason) => {
          if (lastConvertId.current == null) return;
          const r = await dispatch(convertAdminContact({ id: lastConvertId.current, shared_phone_reason: reason }));
          if (convertAdminContact.fulfilled.match(r)) navigate(`/admin/clients/${r.payload.client_id}`);
        }}
      />

      <div className="pf-filters">
        <SearchBox onSearch={setQ} />
      </div>

      <DataTable
        rows={contacts}
        loading={loading}
        emptyKey="contacts.empty"
        rowKey={(c) => c.id}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (c) => (
              <>
                <strong>
                  {c.first_name} {c.last_name}
                </strong>
                <br />
                <span className="pf-muted">{c.email || c.phone || "—"}</span>
              </>
            ),
          },
          {
            key: "phone",
            headerKey: "pf.phone",
            render: (c) => c.phone || "—",
          },
          ...touchColumns(),
          {
            key: "lang",
            headerKey: "admin.profileLanguage",
            render: (c) => t(`lang.${c.preferred_language || "en"}`),
          },
          {
            key: "created",
            headerKey: "pf.created",
            render: (c) => fmt.date(c.created_at),
          },
          {
            key: "actions",
            headerKey: "pf.actions",
            className: "pf-col-actions",
            render: (c) => (
              <div
                className="pf-table-actions gw-people-actions"
                onClick={(e) => e.stopPropagation()}
              >
                {c.phone ? (
                  <>
                    <Link
                      className="pf-btn pf-btn--sm pf-btn--nowrap"
                      to={`/admin/conversations?contact=${c.id}`}
                    >
                      <MessageSquare size={14} aria-hidden />
                      {t("conversations.messageClient")}
                    </Link>
                    <Link
                      className="pf-btn pf-btn--sm pf-btn--nowrap"
                      to={`/admin/conversations?contact=${c.id}&dial=1`}
                    >
                      <Phone size={14} aria-hidden />
                      {t("conversations.callClient")}
                    </Link>
                  </>
                ) : null}
                {canWrite ? (
                  <>
                    <button
                      type="button"
                      className="pf-btn pf-btn--sm pf-btn--nowrap"
                      disabled={rowBusy.isRowLocked(c.id)}
                      onClick={() => {
                        dispatch(clearContactsMutateError());
                        setEditing(c);
                        setOpen(true);
                      }}
                    >
                      {t("pf.edit")}
                    </button>
                    <button
                      type="button"
                      className="pf-btn pf-btn--sm pf-btn--nowrap pf-btn--gold"
                      disabled={
                        rowBusy.isRowLocked(c.id) || (!c.email && !c.phone)
                      }
                      title={
                        !c.email && !c.phone
                          ? t("contacts.convertNeedsPhoneOrEmail")
                          : undefined
                      }
                      onClick={() =>
                        void rowBusy.run(c.id, "convert", async () => {
                          lastConvertId.current = c.id;
                          const r = await dispatch(
                            convertAdminContact({ id: c.id }),
                          );
                          if (convertAdminContact.fulfilled.match(r)) {
                            navigate(`/admin/clients/${r.payload.client_id}`);
                            return true;
                          }
                          return false;
                        })
                      }
                    >
                      <UserPlus size={13} /> {t("contacts.convert")}
                    </button>
                    <button
                      type="button"
                      className="pf-btn pf-btn--sm pf-btn--nowrap pf-btn--danger"
                      disabled={rowBusy.isRowLocked(c.id)}
                      onClick={() => {
                        if (!window.confirm(t("contacts.deleteConfirm"))) return;
                        void rowBusy.run(c.id, "delete", async () => {
                          const r = await dispatch(
                            deleteAdminContact({ id: c.id }),
                          );
                          return deleteAdminContact.fulfilled.match(r);
                        });
                      }}
                    >
                      {t("contacts.delete")}
                    </button>
                  </>
                ) : !c.phone ? (
                  <BookUser size={14} className="pf-muted" aria-hidden />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      <ListPager
        total={total}
        offset={offset}
        limit={PAGE_SIZE}
        loading={loading}
        onPageChange={setOffset}
      />

      <Modal
        open={open}
        titleKey={editing ? "contacts.edit" : "contacts.add"}
        onClose={() => setOpen(false)}
      >
        <Formik
          enableReinitialize
          initialValues={editing ? toForm(editing) : emptyForm()}
          validationSchema={schema}
          onSubmit={async (values) => {
            const payload = {
              first_name: values.first_name.trim(),
              last_name: values.last_name.trim(),
              email: values.email.trim() || null,
              phone: values.phone.trim() || null,
              address_line1: values.address_line1.trim() || null,
              city: values.city.trim() || null,
              state: values.state.trim() || null,
              zip: values.zip.trim() || null,
              preferred_language: values.preferred_language,
              admin_notes: values.admin_notes.trim() || null,
            };
            const r = editing
              ? await dispatch(updateAdminContact({ id: editing.id, ...payload }))
              : await dispatch(createAdminContact(payload));
            const ok = editing
              ? updateAdminContact.fulfilled.match(r)
              : createAdminContact.fulfilled.match(r);
            if (ok) {
              setOpen(false);
              setEditing(null);
              load();
            }
          }}
        >
          <Form className="pf-form">
            <ErrorNote error={mutateError} />
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
            </div>
            <TextField name="email" labelKey="form.email" type="email" />
            <TextField name="phone" labelKey="form.phone" />
            <TextField name="address_line1" labelKey="pf.address" />
            <div className="pf-form-grid">
              <TextField name="city" labelKey="pf.city" />
              <TextField name="state" labelKey="pf.state" />
              <TextField name="zip" labelKey="pf.zip" />
            </div>
            <SelectField
              name="preferred_language"
              labelKey="admin.profileLanguage"
              options={[
                { value: "en", label: t("lang.en") },
                { value: "es", label: t("lang.es") },
              ]}
            />
            <TextField
              name="admin_notes"
              labelKey="pf.notes"
              as="textarea"
              rows={3}
            />
            <p className="pf-muted">{t("contacts.formHint")}</p>
            <SubmitButton
              busy={mutating}
              labelKey={editing ? "pf.save" : "pf.create"}
            />
          </Form>
        </Formik>
      </Modal>
    </div>
  );
}
