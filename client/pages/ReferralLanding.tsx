import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import EnrollApp from "@/components/enroll/EnrollApp";
import EnrollWizard from "@/components/enroll/EnrollWizard";
import EnrollInactive from "@/components/enroll/EnrollInactive";
import EnrollRoleChooser, { type EnrollRole } from "@/components/enroll/EnrollRoleChooser";
import PartnerSignupForm from "@/components/enroll/PartnerSignupForm";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  clearPublicAffiliate,
  fetchPublicAffiliateByCode,
} from "@/store/slices/enrollSlice";
import { persistReferralCode } from "@/lib/referral";
import { Loading } from "@/components/portal/kit";

const REDIRECT_LANDINGS: Record<string, string> = {
  partners: "/partners",
  contact: "/contact",
  "get-credit-report": "/get-credit-report",
};

export default function ReferralLanding() {
  const { t, i18n } = useTranslation();
  const { code = "" } = useParams();
  const [searchParams] = useSearchParams();

  // Affiliates share an English and a Spanish link (?lang=es); both are their clicks.
  const langParam = searchParams.get("lang");
  useEffect(() => {
    if ((langParam === "es" || langParam === "en") && !i18n.language?.startsWith(langParam)) {
      void i18n.changeLanguage(langParam);
    }
  }, [langParam, i18n]);
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data, loading, inactive, error } = useAppSelector((s) => s.enroll.affiliate);

  const toParam =
    searchParams.get("to") || searchParams.get("landing") || "home";
  // ?for=homeowner | partner: ready-made links that skip the first choice.
  const forParam = searchParams.get("for");
  const [role, setRole] = useState<EnrollRole | null>(forParam === "homeowner" || forParam === "partner" ? forParam : null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [role]);

  useEffect(() => {
    if (!code) return;
    dispatch(clearPublicAffiliate());
    void dispatch(fetchPublicAffiliateByCode({ code, to: toParam }));
    return () => {
      dispatch(clearPublicAffiliate());
    };
  }, [code, dispatch, toParam]);

  useEffect(() => {
    if (!data) return;
    persistReferralCode(data.affiliate.referral_code);
    const dest = REDIRECT_LANDINGS[data.landing];
    if (dest) {
      navigate(
        `${dest}?ref=${encodeURIComponent(data.affiliate.referral_code)}`,
        { replace: true },
      );
    }
  }, [data, navigate]);

  if (inactive) {
    return <EnrollInactive />;
  }

  if (loading && !data) {
    return (
      <EnrollApp
        title={t("enroll.metaTitle")}
        description={t("enroll.lead")}
        canonical={`/r/${code}`}
        noIndex
        hideClose
      >
        <div className="enroll-layout enroll-layout--center">
          <Loading />
        </div>
      </EnrollApp>
    );
  }

  if (error || !data) {
    return <EnrollInactive />;
  }

  if (REDIRECT_LANDINGS[data.landing]) {
    return (
      <EnrollApp
        title={t("enroll.metaTitle")}
        description={t("enroll.lead")}
        canonical={`/r/${code}`}
        noIndex
        hideClose
      >
        <div className="enroll-layout enroll-layout--center">
          <Loading />
        </div>
      </EnrollApp>
    );
  }

  const affiliate = data.affiliate;

  return (
    <EnrollApp
      title={t("enroll.referralMetaTitle", {
        name: `${affiliate.first_name} ${affiliate.last_name}`.trim(),
      })}
      description={t("enroll.metaDescription")}
      canonical={`/r/${code}`}
      noIndex
      affiliate={affiliate}
    >
      {role === null ? (
        <EnrollRoleChooser affiliate={affiliate} onPick={setRole} />
      ) : role === "partner" ? (
        <PartnerSignupForm affiliate={affiliate} referralCode={affiliate.referral_code} onBack={() => setRole(null)} />
      ) : (
        <EnrollWizard
          referralCode={affiliate.referral_code}
          affiliate={affiliate}
          leadKey="enroll.referralLead"
          onChangeRole={forParam ? undefined : () => setRole(null)}
        />
      )}
    </EnrollApp>
  );
}
