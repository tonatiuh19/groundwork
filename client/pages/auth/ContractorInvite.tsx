import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthStage from "@/components/portal/AuthStage";
import { ErrorNote, Loading } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { acceptContractorInvite, fetchContractorInvite } from "@/store/slices/onboardingSlice";

export default function ContractorInvite() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { preview, loading, accepting, accepted, applicationPath, error } = useAppSelector(
    (s) => s.onboarding.invite,
  );

  useEffect(() => {
    void dispatch(fetchContractorInvite(token));
  }, [dispatch, token]);

  // Accepting an invite now opens the prequalification application.
  useEffect(() => {
    if (accepted && applicationPath) navigate(applicationPath, { replace: true });
  }, [accepted, applicationPath, navigate]);

  return (
    <AuthStage
      accent="pine"
      titleKey="ctrInvite.title"
      leadKey="ctrInvite.lead"
      pointKeys={["ctrInvite.pointProjects", "ctrInvite.pointPhotos", "ctrInvite.pointDraws"]}
      canonical="/contractor/invite"
    >
      <div className="portal-login-form pf-success">
        {loading ? <Loading /> : null}
        {accepted ? (
          <>
            <CheckCircle2 size={34} />
            <h2>{t("ctrInvite.doneTitle")}</h2>
            <p className="portal-login-hint">{t("ctrInvite.doneBody")}</p>
            <Link className="button button-gold form-submit" to="/contractor/login">
              {t("ctrInvite.goLogin")}
            </Link>
          </>
        ) : preview ? (
          <>
            <h2>{t("ctrInvite.hello", { name: preview.first_name })}</h2>
            <p className="portal-login-hint">
              {t("ctrInvite.body", { email: preview.email })}
              {preview.company ? ` (${preview.company})` : ""}
            </p>
            <ErrorNote error={error} />
            <button
              type="button"
              className={`button button-gold form-submit${accepting ? " pf-btn--busy" : ""}`}
              disabled={accepting}
              aria-busy={accepting || undefined}
              onClick={() => void dispatch(acceptContractorInvite(token))}
            >
              {accepting ? (
                <>
                  <Loader2 className="spin" size={16} aria-hidden /> {t("pf.busy.accepting")}
                </>
              ) : (
                t("ctrInvite.accept")
              )}
            </button>
          </>
        ) : !loading ? (
          <>
            <h2>{t("ctrInvite.invalidTitle")}</h2>
            <ErrorNote error={error || "errors.inviteInvalid"} />
            <Link className="text-link" to="/contractor/login">
              {t("portalAuth.signIn")}
            </Link>
          </>
        ) : null}
      </div>
    </AuthStage>
  );
}
