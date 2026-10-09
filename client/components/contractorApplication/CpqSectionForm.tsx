import { getIn, useFormikContext } from "formik";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContractorApplicationData, ContractorApplicationSection } from "@shared/contractorApplication";
import { MultiCheckField, SelectField, TextField, YesNoField } from "@/components/portal/kit";
import { cn } from "@/lib/cn";
import {
  CPQ_POLICY_COLUMNS,
  CPQ_SECTION_FIELDS,
  cpqDisclosureAnyYes,
  type CpqField,
  type CpqInputKind,
} from "@/lib/contractorApplicationForm";

const INPUT_TYPE: Record<CpqInputKind, { type: string; inputMode?: "numeric" | "tel" | "email" | "url" }> = {
  text: { type: "text" },
  email: { type: "email", inputMode: "email" },
  tel: { type: "tel", inputMode: "tel" },
  date: { type: "date" },
  url: { type: "url", inputMode: "url" },
  number: { type: "text", inputMode: "numeric" },
  textarea: { type: "text" },
};

/** Group-level error (policies, rows, checklists) once the step was submitted. */
function GroupError({ path }: { path: string }) {
  const { errors, submitCount } = useFormikContext<ContractorApplicationData>();
  const err = getIn(errors, path);
  if (!submitCount || typeof err !== "string") return null;
  return (
    <p className="form-error cpq-group-error" role="alert">
      {err}
    </p>
  );
}

function Input({ path, kind, labelKey, required, hintKey, span, autoComplete }: {
  path: string;
  kind: CpqInputKind;
  labelKey: string;
  required?: boolean;
  hintKey?: string;
  span?: 1 | 2 | 4;
  autoComplete?: string;
}) {
  const t = INPUT_TYPE[kind];
  return (
    <TextField
      name={path}
      labelKey={labelKey}
      type={t.type}
      inputMode={t.inputMode}
      as={kind === "textarea" ? "textarea" : undefined}
      rows={kind === "textarea" ? 4 : undefined}
      required={required}
      hintKey={hintKey}
      autoComplete={autoComplete}
      className={span ? `cpq-span-${span}` : undefined}
    />
  );
}

function FieldView({ field }: { field: CpqField }) {
  const { t } = useTranslation();
  const { values } = useFormikContext<ContractorApplicationData>();
  switch (field.kind) {
    case "note":
      return (
        <p className="cpq-note cpq-span-4">
          <Info size={15} aria-hidden /> {t(field.textKey)}
        </p>
      );
    case "select":
      return (
        <div className={cn("cpq-cell", field.span && `cpq-span-${field.span}`)}>
          <SelectField
            name={field.path}
            labelKey={`cpq.f.${field.path}`}
            required={field.required}
            options={[
              { value: "", label: t("cpq.select") },
              ...field.options.map((o) => ({ value: o, label: t(`${field.optionGroup}.${o}`) })),
            ]}
          />
        </div>
      );
    case "yesno":
      return (
        <div className="cpq-span-4">
          <YesNoField name={field.path} labelKey={`cpq.f.${field.path}`} required={field.required} />
        </div>
      );
    case "checks":
      return (
        <div className="cpq-span-4">
          <MultiCheckField
            name={field.path}
            labelKey={`cpq.f.${field.path}`}
            options={field.options}
            optionGroup={field.optionGroup}
            required={field.required}
          />
          <GroupError path={field.path} />
        </div>
      );
    case "policy": {
      // Workers' comp collapses when the contractor is exempt.
      const exempt = field.path === "insurance.workers_comp" && values.insurance.wc_exempt === "yes";
      return (
        <fieldset className="cpq-group cpq-span-4">
          <legend>
            {t(`cpq.f.${field.path}`)}
            {field.required && !exempt ? <em className="pf-req" aria-hidden> *</em> : null}
          </legend>
          {field.optionalHintKey ? <p className="pf-hint">{t(field.optionalHintKey)}</p> : null}
          {exempt ? null : (
            <div className="cpq-grid">
              {CPQ_POLICY_COLUMNS.map((col) => (
                <Input
                  key={col}
                  path={`${field.path}.${col}`}
                  kind={col === "expires_on" ? "date" : "text"}
                  labelKey={`cpq.f.policy.${col}`}
                />
              ))}
            </div>
          )}
          <GroupError path={field.path} />
        </fieldset>
      );
    }
    case "rows": {
      const rows = (getIn(values, field.path) as unknown[]) || [];
      return (
        <fieldset className="cpq-group cpq-span-4">
          <legend>
            {t(`cpq.f.${field.path}`)}
            {field.requiredRows ? <em className="pf-req" aria-hidden> *</em> : null}
          </legend>
          {field.hintKey ? <p className="pf-hint">{t(field.hintKey)}</p> : null}
          {rows.map((_, i) => (
            <div key={i} className="cpq-row">
              <p className="cpq-row-label">{t("cpq.rowN", { n: i + 1 })}</p>
              <div className="cpq-grid">
                {field.columns.map((col) => (
                  <Input
                    key={col.key}
                    path={`${field.path}.${i}.${col.key}`}
                    kind={col.kind}
                    labelKey={`cpq.col.${field.path}.${col.key}`}
                  />
                ))}
              </div>
            </div>
          ))}
          <GroupError path={field.path} />
        </fieldset>
      );
    }
    default:
      return (
        <Input
          path={field.path}
          kind={field.kind}
          labelKey={`cpq.f.${field.path}`}
          required={field.required}
          hintKey={field.hintKey}
          span={field.span}
          autoComplete={field.autoComplete}
        />
      );
  }
}

export default function CpqSectionForm({ section }: { section: ContractorApplicationSection }) {
  const { values } = useFormikContext<ContractorApplicationData>();
  const fields = CPQ_SECTION_FIELDS[section].filter(
    // Explanation only matters once a disclosure is answered "yes".
    (f) => f.kind === "note" || !("path" in f) || f.path !== "safety.disclosure_explanation" || cpqDisclosureAnyYes(values),
  );
  return (
    <div className="cpq-grid cpq-grid--section">
      {fields.map((f, i) => (
        <FieldView key={"path" in f ? f.path : `note-${i}`} field={f} />
      ))}
    </div>
  );
}
