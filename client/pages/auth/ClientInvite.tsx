import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import AuthStage from "@/components/portal/AuthStage";
import { ErrorNote, Loading } from "@/components/portal/kit";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  acceptClientInvite,
  fetchClientInvite,
} from "@/store/slices/enrollSlice";
import {
  fetchPortalMe,
  setPortalUser,
} from "@/store/slices/portalAuthSlice";

export default function ClientInvite() {
  const { t } = useTranslation();
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { preview, loading, accepting, accepted, error } = useAppSelector(
    (s) => s.enroll.clientInvite,
  );

  useEffect(() => {
    void dispatch(fetchClientInvite(token));
  }, [dispatch, token]);

  useEffect(() => {
    if (accepted) {
      navigate("/client", { replace: true });
    }
  }, [accepted, navigate]);

  return (
    <AuthStage
      accent="pine"
      titleKey="cliInvite.title"
      leadKey="cliInvite.lead"
      pointKeys={[
        "cliInvite.pointProject",
        "cliInvite.pointTimeline",
        "cliInvite.pointDocs",
      ]}
      canonical="/client/invite"
    >
      <div className="portal-login-form pf-success">
        {loading ? <Loading /> : null}
        {accepted ? (
          <>
            <CheckCircle2 size={34} />
            <h2>{t("cliInvite.doneTitle")}</h2>
            <p className="portal-login-hint">{t("cliInvite.doneBody")}</p>
          </>
        ) : preview ? (
          <>
            <h2>{t("cliInvite.hello", { name: preview.first_name })}</h2>
            <p className="portal-login-hint">
              {t("cliInvite.body", { email: preview.email })}
            </p>
            <ErrorNote error={error} />
            <button
              type="button"
              className={`button button-gold form-submit${accepting ? " pf-btn--busy" : ""}`}
              disabled={accepting}
              aria-busy={accepting || undefined}
              onClick={async () => {
                const result = await dispatch(acceptClientInvite(token));
                if (acceptClientInvite.fulfilled.match(result)) {
                  dispatch(
                    setPortalUser({
                      actor: "client",
                      user: result.payload.user,
                    }),
                  );
                  void dispatch(fetchPortalMe("client"));
                }
              }}
            >
              {accepting ? (
                <>
                  <Loader2 className="spin" size={16} aria-hidden />{" "}
                  {t("pf.busy.accepting")}
                </>
              ) : (
                t("cliInvite.accept")
              )}
            </button>
          </>
        ) : !loading ? (
          <>
            <h2>{t("cliInvite.invalidTitle")}</h2>
            <ErrorNote error={error || "errors.inviteInvalid"} />
          </>
        ) : null}
      </div>
    </AuthStage>
  );
}
