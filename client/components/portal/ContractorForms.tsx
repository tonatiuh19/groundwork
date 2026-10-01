import { Formik, Form } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  createContractorDraw,
  uploadContractorPhoto,
} from "@/store/slices/contractorPortalSlice";
import { ErrorNote, FileField, SelectField, SubmitButton, TextField } from "@/components/portal/kit";
import { dollarsToCents } from "@/lib/format";

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

type ProjectOption = { public_id: string; property_address: string | null };

function ProjectSelect({
  projects,
  fixed,
}: {
  projects: ProjectOption[];
  fixed?: string;
}) {
  const { t } = useTranslation();
  if (fixed) return null;
  return (
    <SelectField
      name="publicId"
      labelKey="pf.project"
      options={[
        { value: "", label: t("ctr.chooseProject") },
        ...projects.map((p) => ({
          value: p.public_id,
          label: `${p.public_id} · ${p.property_address || "—"}`,
        })),
      ]}
    />
  );
}

export function PhotoForm({
  projects,
  fixedProject,
  onDone,
}: {
  projects: ProjectOption[];
  fixedProject?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { saving, saveError } = useAppSelector((s) => s.contractorPortal);
  const schema = Yup.object({
    publicId: Yup.string().required(t("validation.projectRequired")),
    file: Yup.mixed<File>()
      .required(t("validation.photoFile"))
      .test("type", t("validation.photoFile"), (f) => !!f && PHOTO_ACCEPT.split(",").includes(f.type))
      .test("size", t("validation.photoTooLarge"), (f) => !!f && f.size <= PHOTO_MAX_BYTES),
    caption: Yup.string().trim().max(300),
  });
  return (
    <Formik
      initialValues={{ publicId: fixedProject || "", file: null as File | null, caption: "" }}
      validationSchema={schema}
      onSubmit={async (v, helpers) => {
        const r = await dispatch(
          uploadContractorPhoto({
            publicId: v.publicId,
            file: v.file as File,
            caption: v.caption.trim() || undefined,
          }),
        );
        if (uploadContractorPhoto.fulfilled.match(r)) {
          helpers.resetForm({ values: { publicId: v.publicId, file: null, caption: "" } });
          onDone();
        }
      }}
    >
      <Form className="pf-form">
        <ErrorNote error={saveError} />
        <ProjectSelect projects={projects} fixed={fixedProject} />
        <FileField name="file" labelKey="ctr.photoFile" accept={PHOTO_ACCEPT} />
        <TextField name="caption" labelKey="ctr.caption" />
        <SubmitButton busy={saving} labelKey="ctr.addPhoto" />
      </Form>
    </Formik>
  );
}

export function DrawForm({
  projects,
  fixedProject,
  onDone,
}: {
  projects: ProjectOption[];
  fixedProject?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { saving, saveError } = useAppSelector((s) => s.contractorPortal);
  const schema = Yup.object({
    publicId: Yup.string().required(t("validation.projectRequired")),
    amount: Yup.string()
      .required(t("validation.drawAmount"))
      .test("amount", t("validation.drawAmount"), (v) => (dollarsToCents(v) ?? 0) > 0),
    note: Yup.string().trim().max(2000),
  });
  return (
    <Formik
      initialValues={{ publicId: fixedProject || "", amount: "", note: "" }}
      validationSchema={schema}
      onSubmit={async (v, helpers) => {
        const r = await dispatch(
          createContractorDraw({
            publicId: v.publicId,
            amount_cents: dollarsToCents(v.amount) ?? 0,
            note: v.note.trim() || undefined,
            submit: true,
          }),
        );
        if (createContractorDraw.fulfilled.match(r)) {
          helpers.resetForm({ values: { publicId: v.publicId, amount: "", note: "" } });
          onDone();
        }
      }}
    >
      <Form className="pf-form">
        <ErrorNote error={saveError} />
        <ProjectSelect projects={projects} fixed={fixedProject} />
        <TextField name="amount" labelKey="ctr.drawAmount" type="text" placeholder="0.00" />
        <TextField name="note" labelKey="ctr.drawNote" as="textarea" rows={3} />
        <SubmitButton busy={saving} labelKey="ctr.requestDraw" />
      </Form>
    </Formik>
  );
}
