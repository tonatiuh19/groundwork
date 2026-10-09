import { useMemo, useRef, useState } from "react";
import { Formik, Form, setIn, type FormikErrors, type FormikProps } from "formik";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  FileSignature,
  FileStack,
  HardHat,
  Landmark,
  Loader2,
  MessageSquareWarning,
  Save,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Users,
  UserSquare2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CONTRACTOR_APPLICATION_EDITABLE,
  type ContractorApplicationData,
  type ContractorApplicationPublicView,
  type ContractorApplicationSection,
} from "@shared/contractorApplication";
import { ErrorNote } from "@/components/portal/kit";
import { cn } from "@/lib/cn";
import { useFormatters } from "@/lib/format";
import {
  CPQ_DOCUMENTS_STEP,
  CPQ_REVIEW_STEP,
  CPQ_STEPS,
  cpqSectionIssues,
  type CpqStep,
} from "@/lib/contractorApplicationForm";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { saveContractorApplication } from "@/store/slices/contractorApplicationSlice";
import CpqDocumentsStep from "./CpqDocumentsStep";
import CpqReviewStep from "./CpqReviewStep";
import CpqSectionForm from "./CpqSectionForm";
import CpqSummary from "./CpqSummary";

const STEP_ICONS: Record<CpqStep, LucideIcon> = {
  company: Building2,
  licensing: BadgeCheck,
  insurance: ShieldCheck,
  experience: HardHat,
  personnel: UserSquare2,
  references: Users,
  financial: Landmark,
  safety: ShieldAlert,
  warranty: ScrollText,
  documents: FileStack,
  review: FileSignature,
};

/** Group paths get a specific message; everything else is "required" / "check format". */
const GROUP_ERROR_KEYS: Record<string, string> = {
  "insurance.general_liability": "cpq.err.policy",
  "insurance.workers_comp": "cpq.err.policy",
  "insurance.commercial_auto": "cpq.err.policy",
  "insurance.umbrella": "cpq.err.policy",
  "experience.project_types": "cpq.err.projectTypes",
  "experience.recent_projects": "cpq.err.recentProjects",
  personnel: "cpq.err.personnel",
  "references.clients": "cpq.err.clientRefs",
};

const isSection = (s: CpqStep): s is ContractorApplicationSection =>
  s !== "documents" && s !== "review";

function StatusView({ view, token, onFormat }: {
  view: ContractorApplicationPublicView;
  token: string;
  onFormat: (iso: string | null) => string;
}) {
  const { t } = useTranslation();
  const missingDocs = useAppSelector((s) => s.contractorApplication.missingDocs);
  const st = view.application.status;
  const Icon = st === "approved" ? CheckCircle2 : st === "denied" ? XCircle : Clock3;
  const showDocs = st !== "denied";
  return (
    <div className="cpq-status">
      <section className={cn("enroll-panel cpq-status-card", `is-${st}`)}>
        <Icon size={38} className="cpq-status-icon" aria-hidden />
        <h1 className="enroll-stage-title">{t(`cpq.status.${st}.title`)}</h1>
        <p className="enroll-stage-lead">{t(`cpq.status.${st}.body`)}</p>
        <dl className="cpq-status-meta">
          <div>
            <dt>{t("cpq.number")}</dt>
            <dd>{view.application.application_number}</dd>
          </div>
          {view.application.submitted_at ? (
            <div>
              <dt>{t("cpq.submittedAt")}</dt>
              <dd>{onFormat(view.application.submitted_at)}</dd>
            </div>
          ) : null}
        </dl>
        {missingDocs.length && st === "submitted" ? (
          <p className="cpq-callout cpq-callout--warn">{t("cpq.status.owedDocs", { count: missingDocs.length })}</p>
        ) : null}
      </section>
      {showDocs ? (
        <section className="enroll-panel">
          <h2 className="cpq-panel-title">
            {st === "approved" ? t("cpq.status.renewalsTitle") : t("cpq.status.docsTitle")}
          </h2>
          <CpqDocumentsStep token={token} view={view} data={view.application.data} />
        </section>
      ) : null}
      <section className="enroll-panel">
        <h2 className="cpq-panel-title">{t("cpq.status.answersTitle")}</h2>
        <CpqSummary data={view.application.data} collapsible />
      </section>
    </div>
  );
}

export default function ContractorApplicationWizard({
  token,
  view,
}: {
  token: string;
  view: ContractorApplicationPublicView;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const { saving, saveError, lastSavedAt } = useAppSelector((s) => s.contractorApplication);
  const editable = CONTRACTOR_APPLICATION_EDITABLE.includes(view.application.status);
  const [step, setStep] = useState(() =>
    Math.min(Math.max(view.application.current_step || 0, 0), CPQ_REVIEW_STEP),
  );
  const stepRef = useRef(step);
  stepRef.current = step;
  const savedJson = useRef(JSON.stringify(view.application.data));
  const topRef = useRef<HTMLDivElement>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  // Formik owns answers from first load; later saves never re-seed it (no cursor jumps).
  const initialValues = useMemo(() => view.application.data, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editable) {
    return <StatusView view={view} token={token} onFormat={(iso) => fmt.date(iso)} />;
  }

  const current = CPQ_STEPS[step];
  const total = CPQ_STEPS.length;

  const persist = async (values: ContractorApplicationData, nextStep: number) => {
    const json = JSON.stringify(values);
    if (json === savedJson.current && nextStep === view.application.current_step) return true;
    const r = await dispatch(saveContractorApplication({ token, data: values, current_step: nextStep }));
    if (saveContractorApplication.fulfilled.match(r)) {
      savedJson.current = json;
      return true;
    }
    return false;
  };

  const goTo = async (
    formik: Pick<FormikProps<ContractorApplicationData>, "resetForm">,
    values: ContractorApplicationData,
    next: number,
  ) => {
    const ok = await persist(values, next);
    if (!ok) return;
    // Fresh touched/submitCount so the next step doesn't open full of errors.
    formik.resetForm({ values });
    setSavedNotice(false);
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const validate = (values: ContractorApplicationData): FormikErrors<ContractorApplicationData> => {
    const s = CPQ_STEPS[stepRef.current];
    if (!isSection(s)) return {};
    let errors: FormikErrors<ContractorApplicationData> = {};
    for (const [path, kind] of Object.entries(cpqSectionIssues(values, s))) {
      const msg =
        kind === "format"
          ? t("cpq.err.format")
          : t(GROUP_ERROR_KEYS[path] || "cpq.err.required");
      errors = setIn(errors, path, msg);
    }
    return errors;
  };

  return (
    <Formik<ContractorApplicationData>
      initialValues={initialValues}
      validate={validate}
      validateOnBlur
      validateOnChange={false}
      onSubmit={async (values, helpers) => {
        // "Continue": the step validated cleanly → save + advance.
        await goTo(helpers, values, Math.min(step + 1, CPQ_REVIEW_STEP));
      }}
    >
      {(formik) => (
        <div className="enroll-layout cpq-layout" ref={topRef}>
          <aside className="enroll-rail cpq-rail" aria-label={t("cpq.stepsAria")}>
            <p className="enroll-rail-kicker">{t("cpq.number")} · {view.application.application_number}</p>
            <p className="enroll-rail-hint">{t("cpq.railHint")}</p>
            <ol className="enroll-rail-list">
              {CPQ_STEPS.map((s, i) => {
                const Icon = STEP_ICONS[s];
                const state = i === step ? "is-current" : i < step ? "is-done" : "is-todo";
                return (
                  <li key={s} className={`enroll-rail-item ${state}`}>
                    <button
                      type="button"
                      className="cpq-rail-btn"
                      aria-current={i === step ? "step" : undefined}
                      onClick={() => void goTo(formik, formik.values, i)}
                    >
                      <span className="enroll-rail-icon" aria-hidden>
                        <Icon size={16} />
                      </span>
                      <span className="enroll-rail-label">{t(`cpq.step.${s}`)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <div className="enroll-stage">
            <div className="cpq-mobile-progress" aria-hidden>
              <span style={{ width: `${Math.round(((step + 1) / total) * 100)}%` }} />
            </div>
            <p className="enroll-pill">{t("cpq.stepOf", { current: step + 1, total })}</p>
            <h1 className="enroll-stage-title">{t(`cpq.step.${current}`)}</h1>
            <p className="enroll-stage-lead">{t(`cpq.lead.${current}`)}</p>

            {view.application.status === "needs_info" ? (
              <div className="cpq-callout cpq-callout--info" role="status">
                <MessageSquareWarning size={18} aria-hidden />
                <div>
                  <p className="cpq-callout-title">{t("cpq.needsInfo.title")}</p>
                  {view.application.info_request_note ? <p>{view.application.info_request_note}</p> : null}
                  {view.application.info_request_doc_types.length ? (
                    <p>
                      {t("cpq.needsInfo.docs")}{" "}
                      {view.application.info_request_doc_types.map((k) => t(`cpq.doc.${k}`)).join(", ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="enroll-panel">
              <div className="enroll-form">
                {isSection(current) ? (
                  <Form noValidate>
                    <CpqSectionForm section={current} />
                    {/* Enter submits the step like "Continue". */}
                    <button type="submit" hidden tabIndex={-1} aria-hidden />
                  </Form>
                ) : null}
                {current === "documents" ? (
                  <CpqDocumentsStep token={token} view={view} data={formik.values} />
                ) : null}
                {current === "review" ? (
                  <CpqReviewStep
                    token={token}
                    view={view}
                    data={formik.values}
                    onEditSection={(s) => void goTo(formik, formik.values, CPQ_STEPS.indexOf(s))}
                    onOpenDocuments={() => void goTo(formik, formik.values, CPQ_DOCUMENTS_STEP)}
                  />
                ) : null}

                <ErrorNote error={saveError} />
                {formik.submitCount > 0 && Object.keys(formik.errors).length ? (
                  <p className="form-error" role="alert">
                    {t("cpq.err.fixStep")}
                  </p>
                ) : null}

                <div className="enroll-actions cpq-actions">
                  {step > 0 ? (
                    <button
                      type="button"
                      className="enroll-back"
                      onClick={() => void goTo(formik, formik.values, step - 1)}
                      disabled={saving}
                    >
                      <ArrowLeft size={16} aria-hidden /> {t("enroll.back")}
                    </button>
                  ) : (
                    <span />
                  )}
                  <div className="cpq-actions-right">
                    <button
                      type="button"
                      className="pf-btn"
                      disabled={saving}
                      onClick={async () => {
                        if (await persist(formik.values, step)) setSavedNotice(true);
                      }}
                    >
                      <Save size={15} aria-hidden /> {t("cpq.saveLater")}
                    </button>
                    {current === "review" ? null : current === "documents" ? (
                      <button
                        type="button"
                        className="button button-gold enroll-next"
                        disabled={saving}
                        onClick={() => void goTo(formik, formik.values, CPQ_REVIEW_STEP)}
                      >
                        {t("cpq.toReview")} <ArrowRight size={16} aria-hidden />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`button button-gold enroll-next${saving ? " pf-btn--busy" : ""}`}
                        disabled={saving}
                        aria-busy={saving || undefined}
                        onClick={() => void formik.submitForm()}
                      >
                        {saving ? (
                          <>
                            <Loader2 className="spin" size={16} aria-hidden /> {t("pf.busy.saving")}
                          </>
                        ) : (
                          <>
                            {t("enroll.next")} <ArrowRight size={16} aria-hidden />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {savedNotice && lastSavedAt ? (
                  <p className="cpq-saved" role="status">
                    <CheckCircle2 size={14} aria-hidden /> {t("cpq.savedNotice")}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </Formik>
  );
}
