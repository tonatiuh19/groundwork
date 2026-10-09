import { useMemo, useState } from "react";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { FileWarning, Loader2, PenLine, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  contractorApplicationPathSection,
  contractorApplicationRequirements,
  type ContractorApplicationData,
  type ContractorApplicationPublicView,
  type ContractorApplicationSection,
} from "@shared/contractorApplication";
import SignaturePad from "@/components/portal/SignaturePad";
import { CheckField, ErrorNote, TextField } from "@/components/portal/kit";
import { yupPhoneRequired } from "@/lib/validation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { submitContractorApplication } from "@/store/slices/contractorApplicationSlice";
import CpqSummary from "./CpqSummary";

export default function CpqReviewStep({
  token,
  view,
  data,
  onEditSection,
  onOpenDocuments,
}: {
  token: string;
  view: ContractorApplicationPublicView;
  data: ContractorApplicationData;
  onEditSection: (section: ContractorApplicationSection) => void;
  onOpenDocuments: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { submitting, submitError, missingFields, missingDocs } = useAppSelector((s) => s.contractorApplication);
  const [signature, setSignature] = useState<string | null>(null);
  const [sigTouched, setSigTouched] = useState(false);
  const reqs = useMemo(() => contractorApplicationRequirements(data, view.templates), [data, view.templates]);
  const have = new Set(view.documents.filter((d) => d.status !== "rejected").map((d) => d.doc_type));
  const coreMissing = reqs.docs.filter((r) => r.applicable && r.requirement === "core" && !have.has(r.key));
  const fieldMissing = missingFields.length ? missingFields : reqs.missing_fields;
  const missingSections = [...new Set(fieldMissing.map(contractorApplicationPathSection))];
  const blocked = fieldMissing.length > 0 || coreMissing.length > 0;
  const lang = i18n.language?.startsWith("es") ? "es" : "en";

  const schema = Yup.object({
    signer_name: Yup.string().trim().min(2, t("validation.signerNameRequired")).required(t("validation.signerNameRequired")),
    signer_title: Yup.string().trim().required(t("validation.signerTitleRequired")),
    signer_email: Yup.string().trim().email(t("validation.emailInvalid")).required(t("validation.emailRequired")),
    signer_phone: yupPhoneRequired(t("validation.phoneMin"), t("validation.phoneRequired")),
    certify: Yup.boolean().oneOf([true], t("validation.certifyRequired")),
  });

  return (
    <div className="cpq-review">
      {blocked ? (
        <div className="cpq-callout cpq-callout--warn" role="status">
          <FileWarning size={18} aria-hidden />
          <div>
            <p className="cpq-callout-title">{t("cpq.review.blockedTitle")}</p>
            {missingSections.length ? (
              <p>
                {t("cpq.review.missingSections")}{" "}
                {missingSections.map((s, i) => (
                  <span key={s}>
                    {i ? ", " : ""}
                    <button type="button" className="text-link" onClick={() => onEditSection(s)}>
                      {t(`cpq.step.${s}`)}
                    </button>
                  </span>
                ))}
              </p>
            ) : null}
            {coreMissing.length ? (
              <p>
                {t("cpq.review.missingDocs", { count: coreMissing.length })}{" "}
                <button type="button" className="text-link" onClick={onOpenDocuments}>
                  {t("cpq.review.goDocs")}
                </button>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <CpqSummary data={data} onEdit={onEditSection} missing={fieldMissing} />

      <section className="cpq-sign">
        <h3 className="cpq-sign-title">
          <ShieldCheck size={18} aria-hidden /> {t("cpq.sign.title")}
        </h3>
        <p className="cpq-certification">{view.application.certification_text}</p>
        <Formik
          initialValues={{
            signer_name: data.company.contact_name || `${view.contractor.first_name} ${view.contractor.last_name}`.trim(),
            signer_title: data.company.contact_title || "",
            signer_email: data.company.email || view.contractor.email,
            signer_phone: data.company.phone || "",
            certify: false,
          }}
          validationSchema={schema}
          onSubmit={async (v) => {
            setSigTouched(true);
            if (!signature || blocked) return;
            await dispatch(
              submitContractorApplication({
                token,
                body: {
                  signer_name: v.signer_name.trim(),
                  signer_title: v.signer_title.trim(),
                  signer_email: v.signer_email.trim(),
                  signer_phone: v.signer_phone.trim(),
                  signature_image: signature,
                  certify: true,
                  lang,
                },
              }),
            );
          }}
        >
          <Form className="cpq-sign-form">
            <div className="cpq-grid">
              <TextField name="signer_name" labelKey="cpq.sign.name" required autoComplete="name" className="cpq-span-2" />
              <TextField name="signer_title" labelKey="cpq.sign.titleField" required autoComplete="organization-title" className="cpq-span-2" />
              <TextField name="signer_email" labelKey="form.email" type="email" required autoComplete="email" className="cpq-span-2" />
              <TextField name="signer_phone" labelKey="form.phone" type="tel" required autoComplete="tel" className="cpq-span-2" />
            </div>
            <div className="pf-field">
              <span>
                <PenLine size={14} aria-hidden /> {t("cpq.sign.signature")}
                <em className="pf-req" aria-hidden> *</em>
              </span>
              <SignaturePad
                onChange={(d) => {
                  setSignature(d);
                  if (d) setSigTouched(true);
                }}
                invalid={sigTouched && !signature}
              />
              {sigTouched && !signature ? (
                <span className="form-error">{t("validation.signatureRequired")}</span>
              ) : null}
            </div>
            <CheckField name="certify" labelKey="cpq.sign.certify" />
            <p className="pf-hint">{t("cpq.sign.legal")}</p>
            {submitError && missingDocs.length ? (
              <p className="form-error" role="alert">
                {t("validation.applicationDocsMissing")}: {missingDocs.map((k) => t(`cpq.doc.${k}`)).join(", ")}
              </p>
            ) : (
              <ErrorNote error={submitError} />
            )}
            <button
              type="submit"
              className={`button button-gold cpq-submit${submitting ? " pf-btn--busy" : ""}`}
              disabled={submitting || blocked}
              aria-busy={submitting || undefined}
            >
              {submitting ? (
                <>
                  <Loader2 className="spin" size={16} aria-hidden /> {t("pf.busy.submitting")}
                </>
              ) : (
                t("cpq.sign.submit")
              )}
            </button>
          </Form>
        </Formik>
      </section>
    </div>
  );
}
