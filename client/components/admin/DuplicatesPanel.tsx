import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, CopyX, EyeOff, GitMerge, Link2, Mail, Phone, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DedupeEntity, DuplicateCluster, DuplicateMember, PersonEntity } from "@shared/api";
import {
  BusyButton,
  EmptyState,
  ErrorNote,
  Loading,
  Modal,
  StatusBadge,
} from "@/components/portal/kit";
import { useAdminCan } from "@/hooks/useAdminCan";
import { useFormatters } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearDuplicateActionError,
  deleteDuplicate,
  dismissDuplicate,
  fetchDuplicates,
  linkLeadToRecord,
  mergeDuplicates,
  previewDuplicateDelete,
  previewDuplicateMerge,
} from "@/store/slices/duplicatesSlice";

const RECORD_PATH: Record<DedupeEntity, string> = {
  lead: "/admin/leads?q=",
  client: "/admin/clients/",
  affiliate: "/admin/affiliates/",
  contractor: "/admin/contractors/",
};
const STATUS_GROUP: Record<DedupeEntity, string> = {
  lead: "leadStatus",
  client: "accountStatus",
  affiliate: "accountStatus",
  contractor: "accountStatus",
};
const memberKey = (m: { entity: DedupeEntity; id: number }) => `${m.entity}:${m.id}`;

type Dialog =
  | { kind: "merge"; cluster: DuplicateCluster; keep: DuplicateMember; remove: DuplicateMember[] }
  | { kind: "delete"; cluster: DuplicateCluster; member: DuplicateMember }
  | { kind: "dismiss"; cluster: DuplicateCluster }
  | null;

function recordHref(m: DuplicateMember) {
  return m.entity === "lead" ? `${RECORD_PATH.lead}${encodeURIComponent(m.email || m.name)}` : `${RECORD_PATH[m.entity]}${m.id}`;
}

function ClusterCard({
  cluster,
  canWrite,
  onDialog,
}: {
  cluster: DuplicateCluster;
  canWrite: boolean;
  onDialog: (d: Dialog) => void;
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const busy = useAppSelector((s) => s.duplicates.busy === cluster.signature);
  const people = cluster.members.filter((m) => m.entity !== "lead");
  // Default survivor: the record with the most linked data (then the oldest).
  const best = useMemo(() => {
    const score = (m: DuplicateMember) => Object.values(m.links).reduce((a, b) => a + b, 0);
    return [...cluster.members].sort(
      (a, b) =>
        Number(a.entity === "lead") - Number(b.entity === "lead") ||
        score(b) - score(a) ||
        a.created_at.localeCompare(b.created_at),
    )[0];
  }, [cluster]);
  const [keepKey, setKeepKey] = useState(memberKey(best));
  const keep = cluster.members.find((m) => memberKey(m) === keepKey) || best;
  const sameEntity = cluster.members.filter((m) => m.entity === keep.entity && memberKey(m) !== memberKey(keep));

  return (
    <article className={cn("dup-card", `is-${cluster.kind}`)}>
      <header className="dup-card-head">
        <span className={cn("dup-kind", `is-${cluster.kind}`)}>{t(`duplicates.kind.${cluster.kind}`)}</span>
        <span className="dup-keys">
          {cluster.match_keys.map((k) => (
            <span key={k} className="dup-key">
              {k.startsWith("e:") ? <Mail size={12} aria-hidden /> : <Phone size={12} aria-hidden />}
              {k.slice(2)}
            </span>
          ))}
        </span>
        <p className="pf-hint dup-help">{t(`duplicates.help.${cluster.kind}`)}</p>
      </header>
      <ul className="dup-members">
        {cluster.members.map((m) => {
          const k = memberKey(m);
          const linkCounts = Object.entries(m.links).filter(([, n]) => n > 0);
          const linkTarget =
            m.entity === "lead" && people.length === 1 && (!m.linked || memberKey(m.linked) !== memberKey(people[0]))
              ? people[0]
              : null;
          return (
            <li key={k} className={cn("dup-member", k === keepKey && "is-keep")}>
              <label className="dup-keep">
                <input
                  type="radio"
                  name={`keep-${cluster.signature}`}
                  checked={k === keepKey}
                  onChange={() => setKeepKey(k)}
                  disabled={!canWrite}
                />
                <span className="sr-only">{t("duplicates.keepThis")}</span>
              </label>
              <div className="dup-member-main">
                <p className="dup-member-title">
                  <span className={cn("dup-role", `is-${m.entity}`)}>{t(`duplicates.entity.${m.entity}`)}</span>
                  <Link className="text-link" to={recordHref(m)}>
                    {m.name || "—"} <span className="pf-muted">#{m.id}</span>
                  </Link>
                  <StatusBadge group={STATUS_GROUP[m.entity]} value={m.status} />
                  {m.submission_count && m.submission_count > 1 ? (
                    <span className="dup-count">{t("duplicates.submissions", { count: m.submission_count })}</span>
                  ) : null}
                </p>
                <p className="dup-member-meta">
                  {m.email || <span className="pf-muted">{t("duplicates.noEmail")}</span>}
                  {" · "}
                  {m.phone || <span className="pf-muted">{t("duplicates.noPhone")}</span>}
                  {" · "}
                  {fmt.date(m.created_at)}
                </p>
                {linkCounts.length ? (
                  <p className="dup-links">
                    {linkCounts.map(([key, n]) => (
                      <span key={key} className="dup-link-chip">
                        {t(`duplicates.links.${key}`, { count: n })}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
              {canWrite ? (
                <div className="dup-member-actions">
                  {linkTarget ? (
                    <BusyButton
                      className="pf-btn--sm pf-btn--nowrap"
                      icon={Link2}
                      label={t("duplicates.linkTo", { role: t(`duplicates.entity.${linkTarget.entity}`) })}
                      busy={busy}
                      onClick={() =>
                        void dispatch(
                          linkLeadToRecord({
                            signature: cluster.signature,
                            lead_id: m.id,
                            entity: linkTarget.entity as PersonEntity,
                            id: linkTarget.id,
                          }),
                        )
                      }
                    />
                  ) : null}
                  {k !== keepKey ? (
                    <BusyButton
                      className="pf-btn--sm pf-btn--nowrap"
                      tone="danger"
                      icon={Trash2}
                      label={t("duplicates.delete")}
                      onClick={() => onDialog({ kind: "delete", cluster, member: m })}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canWrite ? (
        <footer className="dup-card-foot">
          <BusyButton
            tone="gold"
            icon={GitMerge}
            label={t("duplicates.mergeInto", { name: keep.name || `#${keep.id}`, count: sameEntity.length })}
            disabled={!sameEntity.length}
            title={!sameEntity.length ? t("duplicates.mergeSameRoleOnly") : undefined}
            onClick={() => onDialog({ kind: "merge", cluster, keep, remove: sameEntity })}
          />
          <BusyButton
            icon={EyeOff}
            label={t("duplicates.notDuplicates")}
            onClick={() => onDialog({ kind: "dismiss", cluster })}
          />
        </footer>
      ) : null}
    </article>
  );
}

/**
 * "Possible duplicates" subsection embedded in an admin list page (Leads,
 * Clients, Affiliates, Contractors). Shows only clusters that include a record
 * of `entity`; collapsed by default, hidden entirely when there are none.
 */
export default function DuplicatesPanel({ entity }: { entity: DedupeEntity }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const canWrite = useAdminCan("approvals");
  const { clusters, loading, error, busy, actionError, actionBlockers, preview } = useAppSelector(
    (s) => s.duplicates,
  );
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void dispatch(fetchDuplicates());
  }, [dispatch]);

  const open = (d: Dialog) => {
    dispatch(clearDuplicateActionError());
    setReason("");
    setDialog(d);
    if (d?.kind === "merge") {
      void dispatch(
        previewDuplicateMerge({ entity: d.keep.entity, keep_id: d.keep.id, remove_ids: d.remove.map((m) => m.id) }),
      );
    }
    if (d?.kind === "delete") void dispatch(previewDuplicateDelete({ entity: d.member.entity, id: d.member.id }));
  };
  const close = () => setDialog(null);
  const done = async (p: Promise<{ type: string }>) => {
    const r = await p;
    if (r.type.endsWith("/fulfilled")) close();
  };

  const mine = clusters.filter((c) => c.members.some((m) => m.entity === entity));
  const shown = kindFilter ? mine.filter((c) => c.kind === kindFilter) : mine;
  const kinds = [...new Set(mine.map((c) => c.kind))];
  const counts = mine.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] || 0) + 1 }), {});
  const blockers = actionBlockers.length ? actionBlockers : preview.merge?.blockers || preview.remove?.blockers || [];
  const dialogBusy = !!dialog && busy === dialog.cluster.signature;

  if (!mine.length && !error) return null;

  return (
    <section className={cn("dup-panel", expanded && "is-open")} aria-label={t("duplicates.title")}>
      <div className="dup-panel-head">
        <button
          type="button"
          className="dup-panel-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <CopyX size={17} aria-hidden />
          <span>
            <strong>{t("duplicates.panelTitle", { count: mine.length })}</strong>
            <small className="pf-hint">{t("duplicates.lead")}</small>
          </span>
          <ChevronDown size={18} aria-hidden className="dup-panel-chevron" />
        </button>
        {expanded ? (
          <button type="button" className="pf-btn pf-btn--sm" onClick={() => void dispatch(fetchDuplicates())} disabled={loading}>
            <RefreshCw size={14} aria-hidden className={loading ? "spin" : undefined} /> {t("duplicates.refresh")}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="dup-panel-body">
          {kinds.length > 1 ? (
            <div className="pf-filters dup-filters" role="tablist" aria-label={t("duplicates.filterAria")}>
              {["", ...kinds].map((k) => (
                <button
                  key={k || "all"}
                  type="button"
                  role="tab"
                  aria-selected={kindFilter === k}
                  className={cn("dup-filter", kindFilter === k && "is-on")}
                  onClick={() => setKindFilter(k)}
                >
                  {k ? t(`duplicates.kind.${k}`) : t("duplicates.all")}
                  <span className="dup-filter-count">{k ? counts[k] || 0 : mine.length}</span>
                </button>
              ))}
            </div>
          ) : null}
          <ErrorNote error={error} />
          {!dialog ? <ErrorNote error={actionError} /> : null}
          {loading && !mine.length ? <Loading /> : null}
          {!loading && !shown.length ? <EmptyState messageKey="duplicates.empty" /> : null}
          <div className="dup-list">
            {shown.map((c) => (
              <ClusterCard key={c.signature} cluster={c} canWrite={canWrite} onDialog={open} />
            ))}
          </div>
        </div>
      ) : null}

      <Modal open={dialog?.kind === "merge"} titleKey="duplicates.mergeTitle" onClose={close}>
        {dialog?.kind === "merge" ? (
          <div className="pf-form">
            <p>
              {t("duplicates.mergeBody", {
                keep: dialog.keep.name || `#${dialog.keep.id}`,
                count: dialog.remove.length,
              })}
            </p>
            {preview.loading ? <Loading /> : null}
            {preview.merge ? (
              <ul className="dup-moves">
                {Object.entries(preview.merge.moves)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => (
                    <li key={k}>
                      {t(`duplicates.move.${k.replace(/\./g, "_")}`, { defaultValue: k })}: <strong>{n}</strong>
                    </li>
                  ))}
              </ul>
            ) : null}
            {preview.merge?.warnings.map((w) => (
              <p key={w} className="cpq-callout cpq-callout--warn">
                {t(`duplicates.warning.${w}`)}
              </p>
            ))}
            {blockers.length ? (
              <p className="cpq-callout cpq-callout--warn">
                {t("duplicates.blocked")} {blockers.map((b) => t(`duplicates.blocker.${b}`)).join(", ")}
              </p>
            ) : null}
            <label className="pf-field">
              <span>{t("duplicates.reason")}</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <ErrorNote error={actionError} />
            <BusyButton
              tone="gold"
              icon={GitMerge}
              label={t("duplicates.confirmMerge")}
              busy={dialogBusy}
              disabled={preview.loading || blockers.length > 0}
              onClick={() =>
                void done(
                  dispatch(
                    mergeDuplicates({
                      signature: dialog.cluster.signature,
                      entity: dialog.keep.entity,
                      keep_id: dialog.keep.id,
                      remove_ids: dialog.remove.map((m) => m.id),
                      reason: reason.trim(),
                    }),
                  ),
                )
              }
            />
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === "delete"} titleKey="duplicates.deleteTitle" onClose={close}>
        {dialog?.kind === "delete" ? (
          <div className="pf-form">
            <p>
              {t("duplicates.deleteBody", {
                role: t(`duplicates.entity.${dialog.member.entity}`),
                name: dialog.member.name || `#${dialog.member.id}`,
              })}
            </p>
            {preview.loading ? <Loading /> : null}
            {preview.remove?.removed_projects ? (
              <p className="cpq-callout cpq-callout--warn">
                {t("duplicates.deleteProjects", { count: preview.remove.removed_projects })}
              </p>
            ) : null}
            {blockers.length ? (
              <p className="cpq-callout cpq-callout--warn">
                {t("duplicates.deleteBlocked")} {blockers.map((b) => t(`duplicates.blocker.${b}`)).join(", ")}
              </p>
            ) : null}
            <label className="pf-field">
              <span>{t("duplicates.reason")}</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <ErrorNote error={actionError} />
            <BusyButton
              tone="danger"
              icon={Trash2}
              label={t("duplicates.confirmDelete")}
              busy={dialogBusy}
              disabled={preview.loading || blockers.length > 0}
              onClick={() =>
                void done(
                  dispatch(
                    deleteDuplicate({
                      signature: dialog.cluster.signature,
                      entity: dialog.member.entity,
                      id: dialog.member.id,
                      reason: reason.trim(),
                    }),
                  ),
                )
              }
            />
          </div>
        ) : null}
      </Modal>

      <Modal open={dialog?.kind === "dismiss"} titleKey="duplicates.dismissTitle" onClose={close}>
        {dialog?.kind === "dismiss" ? (
          <div className="pf-form">
            <p className="pf-muted">{t("duplicates.dismissBody")}</p>
            <label className="pf-field">
              <span>{t("duplicates.reason")}</span>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <ErrorNote error={actionError} />
            <BusyButton
              icon={EyeOff}
              label={t("duplicates.confirmDismiss")}
              busy={dialogBusy}
              disabled={reason.trim().length < 5}
              onClick={() =>
                void done(dispatch(dismissDuplicate({ signature: dialog.cluster.signature, reason: reason.trim() })))
              }
            />
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
