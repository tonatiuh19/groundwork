import { useEffect, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearRegisterError,
  fetchAffiliateClients,
  fetchPublicPlans,
  registerAffiliateClient,
} from "@/store/slices/affiliatePortalSlice";
import {
  CheckField,
  DataTable,
  ErrorNote,
  MilestoneTracker,
  Modal,
  PageHeader,
  SelectField,
  StatusBadge,
  SubmitButton,
  TextField,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";
import DealStatusBadge from "@/components/portal/DealStatusBadge";

export default function AffiliateClients() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { clients, plans, loading, error, registering, registerError } = useAppSelector(
    (s) => s.affiliatePortal,
  );
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchAffiliateClients());
    void dispatch(fetchPublicPlans());
  }, [dispatch]);

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
    phone: Yup.string().trim().min(10, t("validation.phoneMin")).required(t("validation.phoneRequired")),
    property_address: Yup.string().trim().min(5, t("validation.addressRequired")).required(t("validation.addressRequired")),
    homeowner_consent: Yup.boolean().oneOf([true], t("validation.homeownerConsent")),
  });

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="portalNav.myClients"
        leadKey="aff.clientsLead"
        actions={
          <button
            type="button"
            className="button button-gold"
            onClick={() => {
              dispatch(clearRegisterError());
              setCreated(null);
              setOpen(true);
            }}
          >
            <UserPlus size={16} /> {t("aff.registerClient")}
          </button>
        }
      />
      <ErrorNote error={error} />
      <DataTable
        rows={clients}
        loading={loading}
        emptyKey="aff.noClients"
        rowKey={(c) => c.public_id}
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
                <span className="pf-muted">{c.email}</span>
              </>
            ),
          },
          { key: "city", headerKey: "pf.city", render: (c) => c.property_city || "—" },
          { key: "plan", headerKey: "pf.plan", render: (c) => c.plan_name || "—" },
          {
            key: "milestone",
            headerKey: "pf.milestone",
            className: "pf-col-wide",
            render: (c) => <MilestoneTracker milestone={c.milestone} />,
          },
          {
            key: "status",
            headerKey: "pf.status",
            render: (c) => (
              <div className="gw-aff-status">
                <StatusBadge group="milestone" value={c.milestone} />
                <DealStatusBadge en={c.deal_status_en} es={c.deal_status_es} tone={c.deal_status_tone} />
              </div>
            ),
          },
          {
            key: "updates",
            headerKey: "deal.latestUpdate",
            className: "pf-col-wide",
            render: (c) => {
              const ups = c.updates || [];
              if (!ups.length) return <span className="pf-muted">—</span>;
              const line = (u: (typeof ups)[number]) => {
                const status = i18n.language?.startsWith("es") ? u.deal_status_label_es || u.deal_status_label_en : u.deal_status_label_en;
                return [status, u.body].filter(Boolean).join(" — ");
              };
              return (
                <div className="gw-aff-updates">
                  <p>
                    <span className="pf-muted">{fmt.date(ups[0].created_at)}</span> {line(ups[0])}
                  </p>
                  {ups.length > 1 ? (
                    <details>
                      <summary>{t("deal.olderUpdates", { count: ups.length - 1 })}</summary>
                      <ul>
                        {ups.slice(1).map((u) => (
                          <li key={u.id}>
                            <span className="pf-muted">{fmt.date(u.created_at)}</span> {line(u)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              );
            },
          },
          {
            key: "commission",
            headerKey: "portalNav.commissions",
            render: (c) =>
              c.commission_cents != null ? (
                <>
                  {fmt.money(c.commission_cents)}
                  <br />
                  {c.commission_status ? (
                    <StatusBadge group="commStatus" value={c.commission_status} />
                  ) : null}
                </>
              ) : (
                "—"
              ),
          },
          { key: "date", headerKey: "pf.created", render: (c) => fmt.date(c.created_at) },
        ]}
      />

      <Modal open={open} titleKey="aff.registerClient" onClose={() => setOpen(false)}>
        {created ? (
          <div className="pf-success">
            <p>{t("aff.registered", { id: created })}</p>
            <button type="button" className="button button-gold" onClick={() => setOpen(false)}>
              {t("pf.close")}
            </button>
          </div>
        ) : (
          <Formik
            initialValues={{
              first_name: "",
              last_name: "",
              email: "",
              phone: "",
              property_address: "",
              property_city: "",
              property_zip: "",
              adu_plan_id: "",
              homeowner_consent: false,
            }}
            validationSchema={schema}
            onSubmit={async (v) => {
              const result = await dispatch(
                registerAffiliateClient({
                  first_name: v.first_name.trim(),
                  last_name: v.last_name.trim(),
                  email: v.email.trim(),
                  phone: v.phone.trim(),
                  property_address: v.property_address.trim(),
                  property_city: v.property_city.trim() || null,
                  property_zip: v.property_zip.trim() || null,
                  adu_plan_id: v.adu_plan_id ? Number(v.adu_plan_id) : null,
                  preferred_language: i18n.language?.startsWith("es") ? "es" : "en",
                  homeowner_consent: v.homeowner_consent,
                }),
              );
              if (registerAffiliateClient.fulfilled.match(result)) {
                setCreated(result.payload.project_public_id);
                void dispatch(fetchAffiliateClients());
              }
            }}
          >
            <Form className="pf-form">
              <ErrorNote error={registerError} />
              <div className="pf-form-grid">
                <TextField name="first_name" labelKey="form.firstName" />
                <TextField name="last_name" labelKey="form.lastName" />
                <TextField name="email" labelKey="form.email" type="email" />
                <TextField name="phone" labelKey="form.phone" type="tel" />
              </div>
              <TextField name="property_address" labelKey="form.address" />
              <div className="pf-form-grid">
                <TextField name="property_city" labelKey="pf.city" />
                <TextField name="property_zip" labelKey="pf.zip" />
              </div>
              <SelectField
                name="adu_plan_id"
                labelKey="pf.plan"
                options={[
                  { value: "", label: t("aff.planUnknown") },
                  ...plans.map((p) => ({ value: p.id, label: `${p.name} · ${p.sq_ft} ${t("pf.sqft")}` })),
                ]}
              />
              <CheckField name="homeowner_consent" labelKey="aff.homeownerConsent" />
              <SubmitButton busy={registering} labelKey="aff.registerClient" />
            </Form>
          </Formik>
        )}
      </Modal>
    </div>
  );
}
