import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Formik, Form } from "formik";
import * as Yup from "yup";
import { useTranslation } from "react-i18next";
import { UserPlus } from "lucide-react";
import type { AffiliateTeamMember } from "@shared/api";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  fetchAffiliateOverview,
  fetchAffiliateTeam,
  inviteAffiliateSub,
  patchAffiliateSub,
  resendAffiliateSubInvite,
  fetchAffiliateSubClients,
  fetchAffiliateSubCommissions,
  clearTeamError,
} from "@/store/slices/affiliatePortalSlice";
import {
  ErrorNote,
  HeaderAction,
  Loading,
  Modal,
  PageHeader,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/portal/kit";
import { useFormatters } from "@/lib/format";

export default function AffiliateTeam() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const fmt = useFormatters();
  const {
    overview,
    team,
    teamLoading,
    teamError,
    inviting,
    inviteError,
    teamMutating,
    subClients,
    subCommissions,
  } = useAppSelector((s) => s.affiliatePortal);
  const [showInvite, setShowInvite] = useState(false);
  const [detail, setDetail] = useState<AffiliateTeamMember | null>(null);

  useEffect(() => {
    if (!overview) void dispatch(fetchAffiliateOverview());
  }, [dispatch, overview]);

  useEffect(() => {
    if (overview && overview.affiliate.can_manage_team !== true) return;
    dispatch(clearTeamError());
    void dispatch(fetchAffiliateTeam());
  }, [dispatch, overview]);

  useEffect(() => {
    if (!detail) return;
    void dispatch(fetchAffiliateSubClients(detail.id));
    void dispatch(fetchAffiliateSubCommissions(detail.id));
  }, [detail, dispatch]);

  const schema = Yup.object({
    first_name: Yup.string().trim().required(t("validation.firstNameRequired")),
    last_name: Yup.string().trim().required(t("validation.lastNameRequired")),
    email: Yup.string()
      .trim()
      .email(t("validation.emailInvalid"))
      .required(t("validation.emailRequired")),
    phone: Yup.string().trim(),
    company: Yup.string().trim(),
    preferred_language: Yup.string()
      .oneOf(["en", "es"])
      .required(t("validation.invalidField")),
  });

  if (overview && overview.affiliate.can_manage_team !== true) {
    return <Navigate to="/affiliate" replace />;
  }

  return (
    <div className="portal-page">
      <PageHeader
        titleKey="aff.teamTitle"
        leadKey="aff.teamLead"
        actions={
          <HeaderAction
            labelKey="aff.inviteSub"
            icon={UserPlus}
            onClick={() => setShowInvite(true)}
          />
        }
      />
      <ErrorNote error={teamError} />
      {teamLoading && !team.length ? <Loading /> : null}

      {!teamLoading && team.length === 0 ? (
        <p className="pf-muted">{t("aff.teamEmpty")}</p>
      ) : (
        <div className="pf-table-wrap">
          <table className="pf-table">
            <thead>
              <tr>
                <th>{t("form.name")}</th>
                <th>{t("form.email")}</th>
                <th>{t("pf.status")}</th>
                <th>{t("portalNav.myClients")}</th>
                <th>{t("portalNav.commissions")}</th>
                <th>{t("pf.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <td data-label={t("form.name")}>
                    {m.first_name} {m.last_name}
                  </td>
                  <td data-label={t("form.email")}>{m.email}</td>
                  <td data-label={t("pf.status")}>
                    {t(`accountStatus.${m.status}`, { defaultValue: m.status })}
                  </td>
                  <td data-label={t("portalNav.myClients")}>
                    {m.client_count}
                  </td>
                  <td data-label={t("portalNav.commissions")}>
                    {fmt.money(m.commission_cents)}
                  </td>
                  <td data-label={t("pf.actions")}>
                    <div className="pf-actions pf-actions--wrap">
                      <button
                        type="button"
                        className="pf-btn pf-btn--sm"
                        onClick={() => setDetail(m)}
                      >
                        {t("aff.viewSub")}
                      </button>
                      <button
                        type="button"
                        className="pf-btn pf-btn--sm"
                        disabled={teamMutating}
                        onClick={() =>
                          void dispatch(resendAffiliateSubInvite(m.id))
                        }
                      >
                        {t("aff.resendInvite")}
                      </button>
                      {/* Pending subs wait for Groundwork's approval — no toggle until then. */}
                      {m.status === "pending" ? null : (
                        <button
                          type="button"
                          className="pf-btn pf-btn--sm"
                          disabled={teamMutating}
                          onClick={() =>
                            void dispatch(
                              patchAffiliateSub({
                                id: m.id,
                                status:
                                  m.status === "active" ? "inactive" : "active",
                              }),
                            ).then((r) => {
                              if (patchAffiliateSub.fulfilled.match(r)) {
                                void dispatch(fetchAffiliateTeam());
                              }
                            })
                          }
                        >
                          {m.status === "active"
                            ? t("aff.deactivateSub")
                            : t("aff.activateSub")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        titleKey="aff.inviteSub"
      >
        <Formik
          initialValues={{
            first_name: "",
            last_name: "",
            email: "",
            phone: "",
            company: "",
            preferred_language: (i18n.language?.startsWith("es")
              ? "es"
              : "en") as "en" | "es",
          }}
          validationSchema={schema}
          onSubmit={async (v, helpers) => {
            const r = await dispatch(
              inviteAffiliateSub({
                first_name: v.first_name.trim(),
                last_name: v.last_name.trim(),
                email: v.email.trim(),
                phone: v.phone.trim() || undefined,
                company: v.company.trim() || undefined,
                preferred_language: v.preferred_language,
              }),
            );
            if (inviteAffiliateSub.fulfilled.match(r)) {
              setShowInvite(false);
              helpers.resetForm();
              void dispatch(fetchAffiliateTeam());
            }
          }}
        >
          <Form className="pf-form">
            <ErrorNote error={inviteError} />
            <p className="pf-muted">{t("aff.inviteSubHelp")}</p>
            <div className="pf-form-grid">
              <TextField name="first_name" labelKey="form.firstName" />
              <TextField name="last_name" labelKey="form.lastName" />
              <TextField name="email" labelKey="form.email" type="email" />
              <TextField name="phone" labelKey="form.phone" type="tel" />
              <TextField name="company" labelKey="pf.company" />
              <SelectField
                name="preferred_language"
                labelKey="form.language"
                options={[
                  { value: "en", label: t("lang.en") },
                  { value: "es", label: t("lang.es") },
                ]}
              />
            </div>
            <SubmitButton busy={inviting} labelKey="aff.sendInvite" />
          </Form>
        </Formik>
      </Modal>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        titleKey="aff.subDetail"
      >
        {detail ? (
          <div className="pf-stack">
            <strong>
              {detail.first_name} {detail.last_name}
            </strong>
            <p className="pf-muted">
              {detail.email}
              {detail.tracking_url ? (
                <>
                  {" · "}
                  <a
                    href={detail.tracking_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("portalNav.trackingLink")}
                  </a>
                </>
              ) : null}
            </p>
            <h3 className="pf-h3">{t("portalNav.myClients")}</h3>
            {subClients.length === 0 ? (
              <p className="pf-muted">{t("aff.subNoClients")}</p>
            ) : (
              <ul className="pf-plain-list">
                {subClients.map((c) => (
                  <li key={c.public_id}>
                    {c.first_name} {c.last_name} — {c.public_id}
                    {c.commission_cents != null
                      ? ` · ${fmt.money(c.commission_cents)}`
                      : ""}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="pf-h3">{t("portalNav.commissions")}</h3>
            {subCommissions.length === 0 ? (
              <p className="pf-muted">{t("aff.subNoCommissions")}</p>
            ) : (
              <ul className="pf-plain-list">
                {subCommissions.map((c) => (
                  <li key={c.id}>
                    {c.client_name} — {fmt.money(c.amount_cents)} (
                    {t(`aff.role.${c.role || "closer"}`)})
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
