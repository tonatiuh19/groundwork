import { useEffect, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AduPlan } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearAdminSaveError,
  fetchAdminPlans,
  updateAdminPlan,
} from "@/store/slices/adminPortalSlice";
import {
  CheckField,
  DataTable,
  ErrorNote,
  Modal,
  PageHeader,
  StatusBadge,
  SubmitButton,
  TextField,
} from "@/components/portal/kit";
import { centsToDollars, dollarsToCents, useFormatters } from "@/lib/format";
import { useAdminCan } from "@/hooks/useAdminCan";

export default function AdminPlans() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { items, loading, error } = useAppSelector((s) => s.adminPortal.plans);
  const { saving, saveError } = useAppSelector((s) => s.adminPortal);
  const canWrite = useAdminCan("plans.write");
  const [editing, setEditing] = useState<AduPlan | null>(null);

  const load = () => void dispatch(fetchAdminPlans());
  useEffect(() => {
    dispatch(clearAdminSaveError());
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const schema = Yup.object({
    name: Yup.string().trim().required(t("validation.nameRequired")),
    sq_ft: Yup.number().integer().min(1).required(),
  });

  return (
    <div className="portal-page">
      <PageHeader titleKey="portalNav.plans" leadKey="admin.plansLead" />
      <ErrorNote error={error} />
      <DataTable
        rows={items}
        loading={loading}
        rowKey={(p) => p.id}
        columns={[
          {
            key: "name",
            headerKey: "pf.name",
            render: (p) => (
              <div className="pf-plan-row">
                {p.exterior_image_url ? <img src={p.exterior_image_url} alt="" loading="lazy" /> : null}
                <div>
                  <strong>{p.name}</strong>
                  <br />
                  <span className="pf-muted">{p.code}</span>
                </div>
              </div>
            ),
          },
          { key: "beds", headerKey: "cli.bedrooms", render: (p) => p.bedrooms },
          { key: "baths", headerKey: "cli.bathrooms", render: (p) => p.bathrooms },
          { key: "sqft", headerKey: "pf.sqft", render: (p) => p.sq_ft },
          { key: "comm", headerKey: "admin.defaultCommission", render: (p) => fmt.money(p.default_commission_cents) },
          { key: "status", headerKey: "pf.status", render: (p) => <StatusBadge group="accountStatus" value={p.is_active ? "active" : "inactive"} /> },
          {
            key: "edit",
            headerKey: "pf.actions",
            render: (p) =>
              canWrite ? (
                <button type="button" className="pf-btn" onClick={() => { dispatch(clearAdminSaveError()); setEditing(p); }}>
                  <Pencil size={14} /> {t("pf.edit")}
                </button>
              ) : null,
          },
        ]}
      />

      <Modal open={Boolean(editing)} titleKey="admin.editPlan" onClose={() => setEditing(null)}>
        {editing ? (
          <Formik
            initialValues={{
              name: editing.name,
              description: editing.description || "",
              bedrooms: editing.bedrooms,
              stories: editing.stories,
              sq_ft: editing.sq_ft,
              commission: centsToDollars(editing.default_commission_cents),
              exterior_image_url: editing.exterior_image_url || "",
              layout_image_url: editing.layout_image_url || "",
              is_active: Boolean(editing.is_active),
            }}
            validationSchema={schema}
            onSubmit={async (v) => {
              const r = await dispatch(
                updateAdminPlan({
                  id: editing.id,
                  patch: {
                    name: v.name.trim(),
                    description: v.description.trim() || null,
                    bedrooms: Number(v.bedrooms),
                    stories: Number(v.stories),
                    sq_ft: Number(v.sq_ft),
                    default_commission_cents: dollarsToCents(v.commission) ?? 0,
                    exterior_image_url: v.exterior_image_url.trim() || null,
                    layout_image_url: v.layout_image_url.trim() || null,
                    is_active: v.is_active,
                  },
                }),
              );
              if (updateAdminPlan.fulfilled.match(r)) {
                setEditing(null);
                load();
              }
            }}
          >
            <Form className="pf-form">
              <ErrorNote error={saveError} />
              <TextField name="name" labelKey="pf.name" />
              <TextField name="description" labelKey="pf.notes" as="textarea" rows={3} />
              <div className="pf-form-grid">
                <TextField name="bedrooms" labelKey="cli.bedrooms" type="number" />
                <TextField name="stories" labelKey="cli.stories" type="number" />
                <TextField name="sq_ft" labelKey="pf.sqft" type="number" />
                <TextField name="commission" labelKey="admin.defaultCommission" />
              </div>
              <TextField name="exterior_image_url" labelKey="admin.exteriorImage" />
              <TextField name="layout_image_url" labelKey="admin.layoutImage" />
              <CheckField name="is_active" labelKey="admin.planActive" />
              <SubmitButton busy={saving} labelKey="pf.save" />
            </Form>
          </Formik>
        ) : null}
      </Modal>
    </div>
  );
}
