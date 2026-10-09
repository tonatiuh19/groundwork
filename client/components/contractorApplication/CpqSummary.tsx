import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CONTRACTOR_APPLICATION_SECTIONS,
  type ContractorApplicationData,
  type ContractorApplicationSection,
} from "@shared/contractorApplication";
import { CPQ_POLICY_COLUMNS, CPQ_SECTION_FIELDS, cpqGet, type CpqField } from "@/lib/contractorApplicationForm";

function Value({ field, data }: { field: CpqField; data: ContractorApplicationData }): ReactNode {
  const { t } = useTranslation();
  if (field.kind === "note") return null;
  const raw = cpqGet(data, field.path);
  const dash = <span className="pf-muted">—</span>;
  switch (field.kind) {
    case "yesno":
      return raw === "yes" ? t("pf.yes") : raw === "no" ? t("pf.no") : dash;
    case "select":
      return raw ? t(`${field.optionGroup}.${raw}`) : dash;
    case "checks": {
      const list = (raw as string[]) || [];
      return list.length ? list.map((v) => t(`${field.optionGroup}.${v}`)).join(", ") : dash;
    }
    case "policy": {
      const p = (raw as Record<string, string>) || {};
      const parts = CPQ_POLICY_COLUMNS.map((c) => p[c]).filter(Boolean);
      return parts.length ? parts.join(" · ") : dash;
    }
    case "rows": {
      const rows = ((raw as Array<Record<string, string>>) || []).filter((r) =>
        field.columns.some((c) => String(r[c.key] || "").trim()),
      );
      if (!rows.length) return dash;
      return (
        <ol className="cpq-summary-rows">
          {rows.map((r, i) => (
            <li key={i}>{field.columns.map((c) => r[c.key]).filter(Boolean).join(" · ")}</li>
          ))}
        </ol>
      );
    }
    default:
      return String(raw ?? "").trim() || dash;
  }
}

/** Read-only rendering of the application data (wizard review + admin panel). */
export default function CpqSummary({
  data,
  sections = CONTRACTOR_APPLICATION_SECTIONS,
  onEdit,
  redactedSections = [],
  missing = [],
  collapsible = false,
}: {
  data: ContractorApplicationData;
  sections?: ContractorApplicationSection[];
  onEdit?: (section: ContractorApplicationSection) => void;
  redactedSections?: ContractorApplicationSection[];
  /** Missing-field paths to flag inline. */
  missing?: string[];
  collapsible?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="cpq-summary">
      {sections.map((section) => {
        const fields = CPQ_SECTION_FIELDS[section].filter((f) => f.kind !== "note");
        const sectionMissing = missing.filter((m) => m.split(".")[0] === section).length;
        const body = redactedSections.includes(section) ? (
          <p className="pf-muted">{t("cpq.redacted")}</p>
        ) : (
          <dl className="cpq-summary-list">
            {fields.map((f) => {
              const path = (f as { path: string }).path;
              const flagged = missing.some((m) => m === path || m.startsWith(`${path}.`));
              return (
                <div key={path} className={flagged ? "is-missing" : undefined}>
                  <dt>{t(`cpq.f.${path}`)}</dt>
                  <dd>
                    <Value field={f} data={data} />
                  </dd>
                </div>
              );
            })}
          </dl>
        );
        const head = (
          <>
            <span>{t(`cpq.step.${section}`)}</span>
            {sectionMissing ? (
              <span className="cpq-req-chip is-flag">{t("cpq.review.missingCount", { count: sectionMissing })}</span>
            ) : null}
          </>
        );
        return collapsible ? (
          <details key={section} className="cpq-summary-section">
            <summary className="cpq-summary-head">{head}</summary>
            {body}
          </details>
        ) : (
          <section key={section} className="cpq-summary-section">
            <header className="cpq-summary-head">
              {head}
              {onEdit ? (
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => onEdit(section)}>
                  <Pencil size={13} aria-hidden /> {t("cpq.review.edit")}
                </button>
              ) : null}
            </header>
            {body}
          </section>
        );
      })}
    </div>
  );
}
