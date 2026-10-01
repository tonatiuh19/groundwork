import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { GripVertical, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdminProject, ProjectMilestone } from "@shared/api";
import { BOARD_MILESTONES } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearBoardMoving,
  fetchMoreAdminProjectBoard,
  optimisticBoardMove,
  rollbackBoardMove,
  updateAdminProject,
} from "@/store/slices/adminPortalSlice";
import { ErrorNote, Modal, StatusBadge, BusyButton, useBusyAction } from "@/components/portal/kit";
import {
  getMilestoneMoveDirection,
  isBoardDropAllowed,
} from "@/lib/projectBoard";
import { useFormatters } from "@/lib/format";
import { translateApiError } from "@/lib/api";

type PendingMove = {
  project: AdminProject;
  from: ProjectMilestone;
  to: ProjectMilestone;
};

export default function ProjectsBoard({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const fmt = useFormatters();
  const { columns, loading, loadingMore, error, filters, movingId } =
    useAppSelector((s) => s.adminPortal.projectBoard);
  const saveError = useAppSelector((s) => s.adminPortal.saveError);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<ProjectMilestone | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const confirmBusy = useBusyAction(700);

  const draggingProject = useMemo(() => {
    if (!draggingId) return null;
    for (const m of BOARD_MILESTONES) {
      const hit = columns[m].items.find((p) => p.public_id === draggingId);
      if (hit) return hit;
    }
    return null;
  }, [columns, draggingId]);

  const confirmMove = async (move: PendingMove) => {
    await confirmBusy.run(
      async () => {
        dispatch(optimisticBoardMove({ publicId: move.project.public_id, to: move.to }));
        const result = await dispatch(
          updateAdminProject({
            publicId: move.project.public_id,
            patch: { milestone: move.to },
          }),
        );
        if (!updateAdminProject.fulfilled.match(result)) {
          dispatch(
            rollbackBoardMove({
              publicId: move.project.public_id,
              from: move.from,
            }),
          );
          return false;
        }
        dispatch(clearBoardMoving());
        return true;
      },
      { flash: true, onFlashEnd: () => setPending(null) },
    );
  };

  const requestMove = (project: AdminProject, to: ProjectMilestone) => {
    if (!canWrite || movingId) return;
    if (project.milestone === to) return;
    if (
      !isBoardDropAllowed(
        project.milestone,
        to,
        Boolean(project.contractor_id),
      )
    ) {
      return;
    }
    const direction = getMilestoneMoveDirection(project.milestone, to);
    // Same-column adjacent forward/back still confirm jumps/cancel/restore.
    if (
      direction === "jump-forward" ||
      direction === "jump-back" ||
      direction === "cancel" ||
      direction === "restore" ||
      direction === "back"
    ) {
      setPending({ project, from: project.milestone, to });
      return;
    }
    void confirmMove({ project, from: project.milestone, to });
  };

  const onDropColumn = (to: ProjectMilestone) => {
    setDragOver(null);
    if (!draggingProject) return;
    requestMove(draggingProject, to);
    setDraggingId(null);
  };

  const loadMore = (milestone: ProjectMilestone) => {
    const col = columns[milestone];
    if (!col.has_more || loadingMore) return;
    void dispatch(
      fetchMoreAdminProjectBoard({
        milestone,
        offset: col.items.length,
        filters,
      }),
    );
  };

  const directionKey = pending
    ? getMilestoneMoveDirection(pending.from, pending.to)
    : "same";

  if (loading && BOARD_MILESTONES.every((m) => columns[m].items.length === 0)) {
    return (
      <div className="pf-board pf-board--skeleton" aria-busy="true">
        {BOARD_MILESTONES.map((m) => (
          <div key={m} className="pf-board-col">
            <div className="pf-board-col-head">
              <span className="pf-board-skel-line" />
            </div>
            <div className="pf-board-col-body">
              <div className="pf-board-skel-card" />
              <div className="pf-board-skel-card" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="pf-board-wrap">
      <ErrorNote error={error} />
      <ErrorNote error={saveError} />
      <div className="pf-board" role="list">
        {BOARD_MILESTONES.map((m) => {
          const col = columns[m];
          const dropOk =
            !draggingProject ||
            isBoardDropAllowed(
              draggingProject.milestone,
              m,
              Boolean(draggingProject.contractor_id),
            );
          return (
            <section
              key={m}
              className={`pf-board-col pf-board-col--${m}${dragOver === m ? " is-drop" : ""}${
                draggingProject && !dropOk ? " is-blocked" : ""
              }`}
              aria-label={t(`milestone.${m}`)}
              onDragOver={(e) => {
                if (!canWrite || !draggingProject || !dropOk) return;
                e.preventDefault();
                setDragOver(m);
              }}
              onDragLeave={() => setDragOver((cur) => (cur === m ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (!dropOk) return;
                onDropColumn(m);
              }}
            >
              <header className="pf-board-col-head">
                <h3>{t(`milestone.${m}`)}</h3>
                <span className="pf-board-count">{col.total}</span>
              </header>
              <div className="pf-board-col-body">
                {col.items.length === 0 ? (
                  <p className="pf-board-empty">{t("admin.boardEmpty")}</p>
                ) : (
                  col.items.map((p) => (
                    <article
                      key={p.public_id}
                      className={`pf-board-card${movingId === p.public_id ? " is-moving" : ""}`}
                      draggable={canWrite && !movingId}
                      onDragStart={() => setDraggingId(p.public_id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOver(null);
                      }}
                      onClick={() => navigate(`/admin/projects/${p.public_id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(`/admin/projects/${p.public_id}`);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-grabbed={draggingId === p.public_id}
                    >
                      <div className="pf-board-card-top">
                        {canWrite ? (
                          <span className="pf-board-grip" aria-hidden>
                            <GripVertical size={14} />
                          </span>
                        ) : null}
                        <strong>{p.public_id}</strong>
                      </div>
                      <p className="pf-board-card-title">{p.client_name}</p>
                      <p className="pf-muted">
                        {p.property_city || p.property_address || "—"}
                      </p>
                      <div className="pf-board-card-meta">
                        <StatusBadge group="loan" value={p.loan_status} />
                        {p.plan_name ? (
                          <span className="pf-board-chip">{p.plan_name}</span>
                        ) : null}
                      </div>
                      {(p.contractor_name || p.affiliate_name) && (
                        <p className="pf-board-card-people">
                          {p.contractor_name || p.affiliate_name}
                        </p>
                      )}
                      <p className="pf-board-card-date">
                        {fmt.date(p.milestone_changed_at || p.created_at)}
                      </p>
                    </article>
                  ))
                )}
                {col.has_more ? (
                  <button
                    type="button"
                    className="pf-board-more"
                    disabled={loadingMore === m}
                    onClick={() => loadMore(m)}
                  >
                    {loadingMore === m ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      t("admin.boardLoadMore", {
                        remaining: Math.max(0, col.total - col.items.length),
                      })
                    )}
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>

      <Modal
        open={Boolean(pending)}
        titleKey="admin.boardMoveTitle"
        onClose={() => setPending(null)}
      >
        {pending ? (
          <div className="pf-form">
            <p>
              {t(`admin.boardMove.${directionKey}`, {
                from: t(`milestone.${pending.from}`),
                to: t(`milestone.${pending.to}`),
                id: pending.project.public_id,
              })}
            </p>
            {pending.to === "in_build" && !pending.project.contractor_id ? (
              <p className="form-error" role="alert">
                {translateApiError(t, "errors.contractorRequired")}
              </p>
            ) : null}
            <div className="pf-actions">
              <button
                type="button"
                className="button"
                disabled={confirmBusy.busy || confirmBusy.done}
                onClick={() => setPending(null)}
              >
                {t("pf.close")}
              </button>
              <BusyButton
                tone="gold"
                label={t("admin.boardConfirmMove")}
                busyLabel={t("pf.busy.confirming")}
                doneLabel={t("pf.done.moved")}
                busy={confirmBusy.busy}
                done={confirmBusy.done}
                disabled={pending.to === "in_build" && !pending.project.contractor_id}
                onClick={() => void confirmMove(pending)}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
