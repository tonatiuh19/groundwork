import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type MouseEvent, type ReactNode, type SVGProps } from "react";
import { Link } from "react-router-dom";
import { Field, useField } from "formik";
import { ArrowLeft, Check, Copy, FileDown, Link2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MILESTONES, type ProjectMilestone } from "@shared/api";
import PageMeta from "@/components/PageMeta";
import { translateApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { buildAffiliateTrackingUrl } from "@/lib/referral";

export { Modal } from "@/components/portal/Modal";

// ── Busy action helpers ──────────────────────────────────────────────────────

const DEFAULT_FLASH_MS = 900;

/** Per-row busy + optional success flash (table Approve / invite / status). */
export function useRowBusy(flashMs = DEFAULT_FLASH_MS) {
  const [busyId, setBusyId] = useState<number | string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<number | string | null>(null);
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const onFlashEndRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (doneId == null) return;
    const timer = window.setTimeout(() => {
      setDoneId(null);
      setDoneKey(null);
      onFlashEndRef.current?.();
      onFlashEndRef.current = null;
    }, flashMs);
    return () => window.clearTimeout(timer);
  }, [doneId, flashMs]);

  const run = useCallback(
    async (
      id: number | string,
      key: string,
      fn: () => Promise<boolean>,
      opts?: { flash?: boolean; onFlashEnd?: () => void },
    ) => {
      if (busyId != null) return false;
      setBusyId(id);
      setBusyKey(key);
      try {
        const ok = await fn();
        if (!ok) return false;
        if (opts?.flash) {
          onFlashEndRef.current = opts.onFlashEnd ?? null;
          setDoneId(id);
          setDoneKey(key);
        } else {
          opts?.onFlashEnd?.();
        }
        return true;
      } finally {
        setBusyId(null);
        setBusyKey(null);
      }
    },
    [busyId],
  );

  const isBusy = useCallback(
    (id: number | string, key?: string) =>
      busyId === id && (key == null || busyKey === key),
    [busyId, busyKey],
  );

  const isDone = useCallback(
    (id: number | string, key?: string) =>
      doneId === id && (key == null || doneKey === key),
    [doneId, doneKey],
  );

  const isRowLocked = useCallback(
    (id: number | string) => busyId === id || doneId === id,
    [busyId, doneId],
  );

  return { busyId, doneId, busyKey, doneKey, run, isBusy, isDone, isRowLocked };
}

/** Single-control busy + optional success flash (detail header actions). */
export function useBusyAction(flashMs = 0) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const onFlashEndRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!done || flashMs <= 0) return;
    const timer = window.setTimeout(() => {
      setDone(false);
      onFlashEndRef.current?.();
      onFlashEndRef.current = null;
    }, flashMs);
    return () => window.clearTimeout(timer);
  }, [done, flashMs]);

  const run = useCallback(
    async (
      fn: () => Promise<boolean>,
      opts?: { flash?: boolean; onFlashEnd?: () => void },
    ) => {
      if (busy) return false;
      setBusy(true);
      setDone(false);
      try {
        const ok = await fn();
        if (!ok) return false;
        if (opts?.flash && flashMs > 0) {
          onFlashEndRef.current = opts.onFlashEnd ?? null;
          setDone(true);
        } else {
          opts?.onFlashEnd?.();
        }
        return true;
      } finally {
        setBusy(false);
      }
    },
    [busy, flashMs],
  );

  return { busy, done, run };
}

export type BusyButtonTone = "default" | "gold" | "danger";

type BusyIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

/** Portal table/header action with spinner shimmer + optional success flash. */
export function BusyButton({
  busy,
  done,
  label,
  busyLabel,
  doneLabel,
  tone = "default",
  icon: Icon,
  onClick,
  disabled,
  stopPropagation,
  className,
  type = "button",
  title,
}: {
  busy?: boolean;
  done?: boolean;
  label: string;
  busyLabel?: string;
  doneLabel?: string;
  tone?: BusyButtonTone;
  icon?: BusyIcon;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  stopPropagation?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const effectiveTone = done ? "success" : tone;
  const classes = [
    "pf-btn",
    effectiveTone === "gold" ? "pf-btn--gold" : "",
    effectiveTone === "danger" ? "pf-btn--danger" : "",
    effectiveTone === "success" ? "pf-btn--success" : "",
    busy ? "pf-btn--busy" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || busy || done}
      aria-busy={busy || undefined}
      aria-live={done ? "polite" : undefined}
      title={title}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onClick?.(e);
      }}
    >
      {done ? (
        <>
          <Check size={15} aria-hidden /> {doneLabel || label}
        </>
      ) : busy ? (
        <>
          <Loader2 className="spin" size={15} aria-hidden /> {busyLabel || label}
        </>
      ) : (
        <>
          {Icon ? <Icon size={15} aria-hidden /> : null} {label}
        </>
      )}
    </button>
  );
}

// ── Page chrome ──────────────────────────────────────────────────────────────

type HeaderIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

/**
 * Uniform portal section header: Overview eyebrow + title + lead + optional actions.
 * Use on every admin (and other portal) list/detail screen for the same chrome.
 */
export function PageHeader({
  titleKey,
  title,
  leadKey,
  lead,
  eyebrowKey = "portalDash.eyebrow",
  actions,
}: {
  titleKey: string;
  /** Optional live title (e.g. project public id); falls back to titleKey. */
  title?: string;
  leadKey?: string;
  lead?: string;
  eyebrowKey?: string;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const heading = title ?? t(titleKey);
  const body = lead ?? (leadKey ? t(leadKey) : undefined);
  return (
    <header className="pf-header">
      <PageMeta
        title={heading}
        description={body || t(eyebrowKey)}
        noIndex
      />
      <div className="pf-header-copy">
        <p className="eyebrow">
          <span className="eyebrow-line" /> {t(eyebrowKey)}
        </p>
        <h1>{heading}</h1>
        {body ? <p className="portal-page-lead">{body}</p> : null}
      </div>
      {actions ? <div className="pf-actions">{actions}</div> : null}
    </header>
  );
}

/** Gold primary CTA for PageHeader actions — keeps icon + uppercase label consistent. */
export function HeaderAction({
  labelKey,
  icon: Icon,
  onClick,
  disabled,
}: {
  labelKey: string;
  icon?: HeaderIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const label = t(labelKey);
  return (
    <button
      type="button"
      className="button button-gold"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {Icon ? <Icon size={16} aria-hidden /> : null}
      <span className="button-label">{label}</span>
    </button>
  );
}

/** "Back to list" link under a detail PageHeader. */
export function BackLink({ to, labelKey = "pf.back" }: { to: string; labelKey?: string }) {
  const { t } = useTranslation();
  return (
    <Link className="text-link pf-back" to={to}>
      <ArrowLeft size={14} /> {t(labelKey)}
    </Link>
  );
}

/** Identity card at the top of an admin record page (who it is + status + row actions). */
export function RecordHeadCard({
  kicker,
  title,
  subtitle,
  statusGroup,
  status,
  actions,
}: {
  kicker?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  statusGroup: string;
  status: string;
  actions?: ReactNode;
}) {
  return (
    <section className="pf-card">
      <div className="pf-card-top">
        <div>
          {kicker ? <p className="pf-kicker">{kicker}</p> : null}
          <h2>{title}</h2>
          {subtitle ? <p className="pf-muted">{subtitle}</p> : null}
        </div>
        <StatusBadge group={statusGroup} value={status} />
      </div>
      {actions ? <div className="pf-actions">{actions}</div> : null}
    </section>
  );
}

export function StatCard({
  labelKey,
  value,
  hint,
  tone,
  to,
}: {
  labelKey: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "gold" | "alert";
  to?: string;
}) {
  const { t } = useTranslation();
  const body = (
    <>
      <span className="pf-stat-label">{t(labelKey)}</span>
      <strong className="pf-stat-value">{value}</strong>
      {hint ? <span className="pf-stat-hint">{hint}</span> : null}
    </>
  );
  const cls = `pf-stat${tone ? ` pf-stat--${tone}` : ""}`;
  return to ? (
    <Link className={cls} to={to}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <p className="pf-loading">
      <Loader2 className="spin" size={16} /> {t("pf.loading")}
    </p>
  );
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p className="form-error pf-error" role="alert">
      {translateApiError(t, error)}
    </p>
  );
}

export function EmptyState({ messageKey }: { messageKey?: string }) {
  const { t } = useTranslation();
  return <p className="pf-empty">{t(messageKey || "pf.empty")}</p>;
}

// ── Status badges ────────────────────────────────────────────────────────────

const GOOD = [
  "active",
  "accepted",
  "paid",
  "approved",
  "closed",
  "signed",
  "finalized",
  "qualified",
  "published",
  "confirmed",
];
const WARN = [
  "pending",
  "submitted",
  "in_review",
  "needs_info",
  "invited",
  "prospect",
  "new",
  "generated",
  "sent",
  "in_process",
  "underwriting",
  "financing",
  "contracted",
  "in_build",
  "contacted",
  "lead",
  "waitlisted",
];
const BAD = [
  "rejected",
  "void",
  "suspended",
  "denied",
  "cancelled",
  "spam",
  "withdrawn",
];

export function statusTone(value: string): "good" | "warn" | "bad" | "muted" {
  if (GOOD.includes(value)) return "good";
  if (BAD.includes(value)) return "bad";
  if (WARN.includes(value)) return "warn";
  return "muted";
}

export function StatusBadge({
  group,
  value,
}: {
  group: string;
  value: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={`pf-badge pf-badge--${statusTone(value)}`}>
      {t(`${group}.${value}`, { defaultValue: value })}
    </span>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

export type Column<T> = {
  key: string;
  headerKey: string;
  render: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  onRowClick,
  emptyKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyKey?: string;
}) {
  const { t } = useTranslation();
  if (loading && !rows.length) return <Loading />;
  if (!rows.length) return <EmptyState messageKey={emptyKey} />;
  return (
    <div className="pf-table-wrap">
      <table className="pf-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {t(c.headerKey)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "is-clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.className}
                  data-label={t(c.headerKey)}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Form fields (Formik) ─────────────────────────────────────────────────────

export function TextField({
  name,
  labelKey,
  type = "text",
  as,
  rows,
  placeholder,
  disabled,
  required,
  hintKey,
  inputMode,
  autoComplete,
  className,
}: {
  name: string;
  labelKey: string;
  type?: string;
  as?: "textarea";
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Shows a required marker (validation stays in the form schema). */
  required?: boolean;
  hintKey?: string;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "url";
  autoComplete?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [, meta] = useField(name);
  const invalid = !!(meta.touched && meta.error);
  return (
    <label className={cn("pf-field", invalid && "pf-field--invalid", className)}>
      <span>
        {t(labelKey)}
        {required ? <em className="pf-req" aria-hidden> *</em> : null}
      </span>
      <Field
        name={name}
        type={as ? undefined : type}
        as={as}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
      />
      {hintKey ? <small className="pf-hint">{t(hintKey)}</small> : null}
      {invalid ? <span className="form-error">{meta.error}</span> : null}
    </label>
  );
}

/** Formik-bound Yes / No segmented radio (values `"yes"` | `"no"`, empty = unanswered). */
export function YesNoField({
  name,
  labelKey,
  required,
  disabled,
}: {
  name: string;
  labelKey: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [field, meta, helpers] = useField<string>(name);
  const invalid = !!(meta.touched && meta.error);
  const labelId = `${useId()}-label`;
  return (
    <div className={cn("pf-yesno", invalid && "pf-field--invalid")}>
      <span id={labelId} className="pf-yesno-label">
        {t(labelKey)}
        {required ? <em className="pf-req" aria-hidden> *</em> : null}
      </span>
      <div
        className="pf-yesno-options"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
      >
        {(["yes", "no"] as const).map((v) => (
          <label key={v} className={cn("pf-yesno-option", field.value === v && "is-on")}>
            <input
              type="radio"
              name={name}
              value={v}
              checked={field.value === v}
              disabled={disabled}
              onChange={() => {
                helpers.setTouched(true, false);
                helpers.setValue(v);
              }}
            />
            <span>{t(v === "yes" ? "pf.yes" : "pf.no")}</span>
          </label>
        ))}
      </div>
      {invalid ? <span className="form-error">{meta.error}</span> : null}
    </div>
  );
}

/** Formik-bound checkbox group over a string array. */
export function MultiCheckField({
  name,
  labelKey,
  options,
  optionGroup,
  required,
  disabled,
}: {
  name: string;
  labelKey: string;
  options: readonly string[];
  /** i18n group for option labels (`${optionGroup}.${value}`). */
  optionGroup: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [field, meta, helpers] = useField<string[]>(name);
  const value = field.value || [];
  const invalid = !!(meta.touched && meta.error);
  return (
    <fieldset className={cn("pf-multicheck", invalid && "pf-field--invalid")}>
      <legend>
        {t(labelKey)}
        {required ? <em className="pf-req" aria-hidden> *</em> : null}
      </legend>
      <div className="pf-multicheck-options">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <label key={o} className={cn("pf-chip-check", on && "is-on")}>
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={() => {
                  helpers.setTouched(true, false);
                  helpers.setValue(on ? value.filter((x) => x !== o) : [...value, o]);
                }}
              />
              <span>{t(`${optionGroup}.${o}`)}</span>
            </label>
          );
        })}
      </div>
      {invalid ? <span className="form-error">{meta.error}</span> : null}
    </fieldset>
  );
}

export function SelectField({
  name,
  labelKey,
  options,
  disabled,
  required,
}: {
  name: string;
  labelKey: string;
  options: Array<{ value: string | number; label: string }>;
  disabled?: boolean;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [, meta] = useField(name);
  return (
    <label className={cn("pf-field", meta.touched && meta.error && "pf-field--invalid")}>
      <span>
        {t(labelKey)}
        {required ? <em className="pf-req" aria-hidden> *</em> : null}
      </span>
      <Field as="select" name={name} disabled={disabled}>
        {options.map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </Field>
      {meta.touched && meta.error ? (
        <span className="form-error">{meta.error}</span>
      ) : null}
    </label>
  );
}

export function CheckField({
  name,
  labelKey,
  disabled,
}: {
  name: string;
  labelKey: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [, meta] = useField(name);
  return (
    <label className="pf-check">
      <Field type="checkbox" name={name} disabled={disabled} />
      <span>{t(labelKey)}</span>
      {meta.touched && meta.error ? (
        <em className="form-error">{meta.error}</em>
      ) : null}
    </label>
  );
}

/** Compact inline status/role picker used in table rows. */
export function InlineSelect({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <select
      className="pf-inline-select"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SubmitButton({
  busy,
  labelKey,
  form,
}: {
  busy?: boolean;
  labelKey: string;
  /** Submit a form by id from outside it (e.g. a drawer footer). */
  form?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      className="button button-gold pf-submit"
      type="submit"
      form={form}
      disabled={busy}
    >
      {busy ? <Loader2 className="spin" size={16} /> : t(labelKey)}
    </button>
  );
}

/** Download link for an API-rendered PDF (plain navigation — the session cookie is sent by the browser). */
export function PdfLink({ path }: { path: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("es") ? "es" : "en";
  return (
    <a
      className="text-link"
      href={`/api${path}?lang=${lang}`}
      target="_blank"
      rel="noreferrer"
    >
      <FileDown size={13} /> {t("pf.downloadPdf")}
    </a>
  );
}

/** Formik-bound single file input (stores the `File` in form state). */
export function FileField({
  name,
  labelKey,
  accept,
}: {
  name: string;
  labelKey: string;
  accept?: string;
}) {
  const { t } = useTranslation();
  const [field, meta, helpers] = useField<File | null>(name);
  const ref = useRef<HTMLInputElement>(null);
  // File inputs are uncontrolled: clear the visible filename when the form resets.
  useEffect(() => {
    if (!field.value && ref.current) ref.current.value = "";
  }, [field.value]);
  return (
    <label className="pf-field">
      <span>{t(labelKey)}</span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        onChange={(e) => {
          helpers.setTouched(true, false);
          helpers.setValue(e.currentTarget.files?.[0] ?? null);
        }}
      />
      {meta.touched && meta.error ? (
        <span className="form-error">{meta.error}</span>
      ) : null}
    </label>
  );
}

export function CopyButton({
  value,
  compact,
}: {
  value: string;
  /** Tighter control for table action columns (no wrap). */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const label = t(done ? "pf.copied" : "pf.copy");
  return (
    <button
      type="button"
      className={cn("pf-btn", "pf-btn--nowrap", compact && "pf-btn--sm")}
      aria-label={label}
      title={label}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1800);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      <span>{label}</span>
    </button>
  );
}

/**
 * Vanity tracking path chip — gold rail, truncate long slugs, click to copy full URL.
 * Referral codes stay out of the UI (attribution-only under the hood).
 */
export function TrackingLinkChip({
  slug,
  referralCode,
}: {
  slug?: string | null;
  referralCode: string;
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  const pathKey = String(slug || referralCode).trim();
  const fullUrl = buildAffiliateTrackingUrl({
    referral_code: referralCode,
    slug,
  });
  const label = done
    ? t("pf.copied")
    : t("admin.copyTrackingLink", { path: `/r/${pathKey}` });

  return (
    <button
      type="button"
      className={cn("pf-tracking-chip", done && "is-copied")}
      aria-label={label}
      title={fullUrl}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(fullUrl);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
    >
      <Link2 size={14} className="pf-tracking-chip__icon" aria-hidden />
      <span className="pf-tracking-chip__path">
        <span className="pf-tracking-chip__prefix">/r/</span>
        <span className="pf-tracking-chip__slug">{pathKey}</span>
      </span>
      <span className="pf-tracking-chip__action" aria-hidden>
        {done ? <Check size={14} /> : <Copy size={14} />}
      </span>
    </button>
  );
}

// ── Milestones ───────────────────────────────────────────────────────────────

export function MilestoneTracker({
  milestone,
}: {
  milestone: ProjectMilestone;
}) {
  const { t } = useTranslation();
  if (milestone === "cancelled") {
    return <p className="pf-badge pf-badge--bad">{t("milestone.cancelled")}</p>;
  }
  const current = MILESTONES.indexOf(milestone);
  return (
    <ol className="pf-tracker" aria-label={t("pf.milestone")}>
      {MILESTONES.map((m, i) => (
        <li
          key={m}
          className={
            i < current ? "is-done" : i === current ? "is-current" : undefined
          }
          aria-current={i === current ? "step" : undefined}
        >
          <span className="pf-tracker-dot">
            {i < current ? <Check size={12} /> : i + 1}
          </span>
          <span className="pf-tracker-label">{t(`milestone.${m}`)}</span>
        </li>
      ))}
    </ol>
  );
}

export const milestoneOptions = (
  t: (k: string) => string,
  withCancelled = true,
) =>
  [...MILESTONES, ...(withCancelled ? (["cancelled"] as const) : [])].map(
    (m) => ({
      value: m as string,
      label: t(`milestone.${m}`),
    }),
  );

// ── Filters ──────────────────────────────────────────────────────────────────

/**
 * Debounced search box: calls `onSearch` 300ms after typing stops. Pass `value`
 * when the query lives in the store so a "clear filters" action empties the input.
 */
/**
 * Segmented tabs for list scopes (e.g. Active / Converted / All). Wraps on
 * phones; optional count badge per tab.
 */
export function SegmentedTabs<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: V;
  onChange: (v: V) => void;
  options: { value: V; labelKey: string; count?: number | null }[];
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="pf-segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`pf-segmented-tab${value === o.value ? " is-active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {t(o.labelKey)}
          {o.count != null ? <span className="pf-segmented-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({
  value,
  onSearch,
}: {
  value?: string;
  onSearch: (q: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(value ?? "");
  useEffect(() => {
    if (value !== undefined && value !== text.trim()) setText(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = window.setTimeout(() => onSearch(text.trim()), 300);
    return () => window.clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className="pf-search"
      type="search"
      value={text}
      placeholder={t("pf.search")}
      aria-label={t("pf.search")}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

/** "All …" dropdown for the `pf-filters` bar above a list. Empty value means no filter. */
export function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string | number; label: string }>;
  ariaLabel: string;
  allLabel: string;
}) {
  return (
    <select
      className="pf-inline-select"
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ListPager({
  total,
  limit,
  offset,
  onPageChange,
  loading,
}: {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (offset: number) => void;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  if (total <= 0) return null;
  if (total <= limit && offset === 0) return null;
  const from = Math.min(total, offset + 1);
  const to = Math.min(total, offset + limit);
  const canPrev = offset > 0 && !loading;
  const canNext = offset + limit < total && !loading;
  return (
    <div className="pf-pager" role="navigation" aria-label={t("pf.showingRange", { from, to, total })}>
      <p className="pf-muted">{t("pf.showingRange", { from, to, total })}</p>
      <div className="pf-pager-actions">
        <button type="button" className="pf-btn" disabled={!canPrev} onClick={() => onPageChange(Math.max(0, offset - limit))}>
          {t("pf.prev")}
        </button>
        <button type="button" className="pf-btn" disabled={!canNext} onClick={() => onPageChange(offset + limit)}>
          {t("pf.next")}
        </button>
      </div>
    </div>
  );
}

export const enumOptions = (
  t: (k: string) => string,
  group: string,
  values: readonly string[],
) => values.map((v) => ({ value: v, label: t(`${group}.${v}`) }));
