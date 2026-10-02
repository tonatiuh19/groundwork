import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";
import PageMeta from "@/components/PageMeta";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchPortalMe } from "@/store/slices/portalAuthSlice";
import { approveMcpConsent } from "@/store/slices/adminMcpSlice";
import { translateApiError } from "@/lib/api";
import { logger } from "@/utils/logger";

/**
 * OAuth consent for remote MCP (Cursor / Claude).
 * Opened by /api/mcp/oauth/authorize. Outside admin shell; still requires login.
 * super_admin only — others see a forbidden message.
 */
export default function AdminMcpConsent() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [params] = useSearchParams();
  const { user, bootstrapped, loadingMe } = useAppSelector(
    (s) => s.portalAuth.admin,
  );
  const { consentBusy, error } = useAppSelector((s) => s.adminMcp);

  useEffect(() => {
    void dispatch(fetchPortalMe("admin"));
  }, [dispatch]);

  const oauth = useMemo(
    () => ({
      client_id: params.get("client_id") || "",
      redirect_uri: params.get("redirect_uri") || "",
      code_challenge: params.get("code_challenge") || "",
      code_challenge_method: params.get("code_challenge_method") || "S256",
      scope: params.get("scope") || "groundwork.admin.read",
      resource: params.get("resource") || "",
      state: params.get("state") || "",
    }),
    [params],
  );

  const missing =
    !oauth.client_id || !oauth.redirect_uri || !oauth.code_challenge;

  const returnPath = useMemo(() => {
    const q = params.toString();
    return `/admin/mcp-consent${q ? `?${q}` : ""}`;
  }, [params]);

  const submit = (approve: boolean) => {
    if (missing) return;
    void dispatch(approveMcpConsent({ ...oauth, approve }))
      .unwrap()
      .then((redirectTo) => {
        window.location.href = redirectTo;
      })
      .catch((e) => logger.warn("mcp consent failed", e));
  };

  if (!bootstrapped || loadingMe) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <PageMeta
          title={t("adminMcp.consentTitle")}
          description={t("adminMcp.consentSubtitle")}
          canonical="/admin/mcp-consent"
          noIndex
        />
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-10">
        <PageMeta
          title={t("adminMcp.loginRequiredTitle")}
          description={t("adminMcp.loginRequiredBody")}
          canonical="/admin/mcp-consent"
          noIndex
        />
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 text-sm space-y-4">
          <h1 className="text-lg font-semibold text-foreground">
            {t("adminMcp.loginRequiredTitle")}
          </h1>
          <p className="text-muted-foreground">{t("adminMcp.loginRequiredBody")}</p>
          <Link
            to={`/admin/login?return=${encodeURIComponent(returnPath)}`}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("adminMcp.goLogin")}
          </Link>
        </div>
      </div>
    );
  }

  if (user.role !== "super_admin") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <PageMeta
          title={t("adminMcp.superOnlyTitle")}
          description={t("adminMcp.superOnlyBody")}
          canonical="/admin/mcp-consent"
          noIndex
        />
        <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-card p-6 text-sm text-destructive">
          {t("adminMcp.superOnlyBody")}
        </div>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <PageMeta
          title={t("adminMcp.consentTitle")}
          description={t("adminMcp.invalidRequest")}
          canonical="/admin/mcp-consent"
          noIndex
        />
        <div className="max-w-md w-full rounded-2xl border border-destructive/30 bg-card p-6 text-sm text-destructive">
          {t("adminMcp.invalidRequest")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-10">
      <PageMeta
        title={t("adminMcp.consentTitle")}
        description={t("adminMcp.consentSubtitle")}
        canonical="/admin/mcp-consent"
        noIndex
      />
      <div className="max-w-lg w-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="bg-primary/5 border-b border-border px-5 sm:px-6 py-5 flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Sparkles className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {t("adminMcp.consentTitle")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("adminMcp.consentSubtitle")}
            </p>
          </div>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-4 text-sm">
          <div className="flex items-start gap-2 text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p>
              {t("adminMcp.consentAs", {
                name: `${user.first_name} ${user.last_name}`.trim() || t("adminMcp.you"),
                email: user.email,
              })}
            </p>
          </div>
          <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
            <li>{t("adminMcp.permLeads")}</li>
            <li>{t("adminMcp.permProjects")}</li>
            <li>{t("adminMcp.permPeople")}</li>
            <li>{t("adminMcp.permFinance")}</li>
            <li>{t("adminMcp.permEvents")}</li>
            <li>{t("adminMcp.permWrites")}</li>
          </ul>
          <p className="text-xs text-muted-foreground">{t("adminMcp.consentNote")}</p>
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-xs px-3 py-2">
              {translateApiError(t, error)}
            </div>
          ) : null}
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-border flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            disabled={consentBusy}
            onClick={() => submit(false)}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground disabled:opacity-50"
          >
            {t("adminMcp.deny")}
          </button>
          <button
            type="button"
            disabled={consentBusy}
            onClick={() => submit(true)}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {consentBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t("adminMcp.allow")}
          </button>
        </div>
      </div>
    </div>
  );
}
